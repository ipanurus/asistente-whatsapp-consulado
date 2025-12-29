const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const sqlite3 = require('sqlite3').verbose();

// ==================== CONFIGURACIÓN ====================
const CONFIG = {
  TWILIO_ACCOUNT_SID: 'AC404986236214d4a76c055fd7266b5483',
  TWILIO_AUTH_TOKEN: '6165b315d44938d88628d1405e745e17',
  TWILIO_WHATSAPP_NUMBER: 'whatsapp:+14155238886',
ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,  PORT: 3000
};

// ==================== INICIALIZACIÓN ====================
const app = express();
const twilioClient = twilio(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ==================== BASE DE DATOS ====================
const db = new sqlite3.Database('./conversaciones.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      respuesta TEXT,
      idioma TEXT,
      servicio TEXT,
      etapa TEXT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono TEXT UNIQUE NOT NULL,
      nombre TEXT,
      servicio TEXT,
      etapa TEXT,
      idioma TEXT,
      opcion_seleccionada TEXT,
      documentos_enviados INTEGER DEFAULT 0,
      cita_solicitada INTEGER DEFAULT 0,
      es_cliente_existente INTEGER DEFAULT 0,
      notas TEXT,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ==================== FUNCIONES DE BASE DE DATOS ====================
function obtenerCliente(telefono) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM clientes WHERE telefono = ?', [telefono], (err, row) => {
      if (err) reject(err);
      else if (row) resolve(row);
      else {
        db.run('INSERT INTO clientes (telefono, etapa) VALUES (?, ?)', [telefono, 'inicial'], function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, telefono, etapa: 'inicial', es_cliente_existente: 0 });
        });
      }
    });
  });
}

function actualizarCliente(telefono, datos) {
  return new Promise((resolve, reject) => {
    const campos = Object.keys(datos).map(k => `${k} = ?`).join(', ');
    const valores = Object.values(datos);
    valores.push(telefono);
    
    db.run(`UPDATE clientes SET ${campos}, ultima_actualizacion = CURRENT_TIMESTAMP WHERE telefono = ?`, valores, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function obtenerHistorial(telefono, limite = 6) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT mensaje, respuesta FROM conversaciones WHERE telefono = ? ORDER BY fecha DESC LIMIT ?',
      [telefono, limite],
      (err, rows) => {
        if (err) reject(err);
        else {
          const mensajes = [];
          rows.reverse().forEach(row => {
            mensajes.push({ role: 'user', content: row.mensaje });
            if (row.respuesta) {
              mensajes.push({ role: 'assistant', content: row.respuesta });
            }
          });
          resolve(mensajes);
        }
      }
    );
  });
}

function guardarConversacion(telefono, mensaje, respuesta, idioma, servicio, etapa) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO conversaciones (telefono, mensaje, respuesta, idioma, servicio, etapa) VALUES (?, ?, ?, ?, ?, ?)',
      [telefono, mensaje, respuesta, idioma, servicio, etapa],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function contarConversaciones(telefono) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as total FROM conversaciones WHERE telefono = ?', [telefono], (err, row) => {
      if (err) reject(err);
      else resolve(row.total);
    });
  });
}

// ==================== DETECCIÓN DE IDIOMA ====================
function detectarIdioma(texto) {
  const textoLower = texto.toLowerCase();
  
  const palabrasDarija = ['سلام', 'السلام', 'واش', 'كيفاش', 'بغيت', 'عافاك', 'شكرا', 'شنو', 'القضية', 'ديالك', 'مرحبا'];
  if (palabrasDarija.some(palabra => texto.includes(palabra))) return 'darija';
  
  const palabrasFrances = ['bonjour', 'merci', 'visa', 'rendez-vous', 'documents', 'je', 'vous', 'votre', 'pour', 'salut'];
  if (palabrasFrances.some(palabra => textoLower.includes(palabra))) return 'frances';
  
  const palabrasIngles = ['hello', 'visa', 'appointment', 'documents', 'lawyer', 'consultation', 'how', 'can', 'thanks'];
  if (palabrasIngles.some(palabra => textoLower.includes(palabra))) return 'ingles';
  
  return 'espanol';
}

// ==================== DETECCIÓN DE SERVICIO ====================
function detectarServicio(texto) {
  const textoLower = texto.toLowerCase();
  
  if (textoLower.match(/reagrup|familia|familiar|cónyuge|esposa|marido|pareja/i)) return 'reagrupacion';
  if (textoLower.match(/trabajo|empleo|cuenta ajena|laboral|contrato de trabajo/i)) return 'trabajo';
  if (textoLower.match(/estudio|estudiar|universidad|master|estudiante|student/i)) return 'estudios';
  if (textoLower.match(/tarjeta|larga durac|perdí.*tarjeta|recuper.*tarjeta|ld|ld-ue/i)) return 'tarjeta';
  if (textoLower.match(/matrimonio|casar|boda|capacidad|novio|novia|prometido|mariage/i)) return 'matrimonio';
  if (textoLower.match(/penal|antecedentes|cancelac|delito|casier/i)) return 'penales';
  if (textoLower.match(/hijo|hija|inscripci|registro civil|pasaporte.*hijo|enfant/i)) return 'inscripcion';
  if (textoLower.match(/nacionalidad/i) && textoLower.match(/adulto|mio|mía|para mi|nationalité/i)) return 'nacionalidad';
  if (textoLower.match(/no lucrativ|residencia sin trabajo|jubilación|rentier/i)) return 'nolucrativa';
  if (textoLower.match(/denegac|deneg|rechazo|negat|rechaz|refus/i)) return 'denegacion';
  
  return null;
}

// ==================== SYSTEM PROMPT ====================
const SYSTEM_PROMPT = `Eres el asistente automático del despacho CONSULADO.ABOGADO, especializado en derecho de extranjería y trámites consulares.

REGLAS FUNDAMENTALES:
1. NUNCA uses emojis
2. Sé profesional, directo, sin ser excesivamente servicial
3. No inventes información sobre plazos del consulado
4. Sigue EXACTAMENTE las respuestas predefinidas
5. Las respuestas están en la variable CONTEXTO_CLIENTE - úsalas tal cual

IMPORTANTE: Responde en el idioma detectado del cliente. Si el cliente escribe en darija, responde en darija. Si en francés, en francés.

DETECCIÓN DE CLIENTE EXISTENTE:
- Si es_cliente_existente = 1: "Por favor déjenos su pregunta y le responderemos el próximo día laborable."
- Solo usa esta respuesta para clientes existentes

MENSAJES DE AUDIO/VOZ:
Si el usuario menciona que envió audio o voz, responde:
ESPAÑOL: "Ahora mismo tenemos desconectado el audio. Te responderemos cuando lo escuchemos en horario laboral, o si prefieres escríbeme un mensaje."
DARIJA: "دابا الصوت مسدود. غادي نجاوبوك فاش نسمعوه فوقت الخدمة، أو اكتب رسالة"
FRANCÉS: "L'audio est actuellement désactivé. Nous vous répondrons quand nous l'écouterons pendant les heures de bureau, ou écrivez un message"
INGLÉS: "Audio is currently disabled. We'll respond when we listen to it during office hours, or write a message"

MAL ESPAÑOL DETECTADO:
Si el cliente escribe mal en español, pregunta:
"¿Prefieres continuar en español o cambiar a otro idioma? (Darija/العربية, Français, English)"

Las respuestas específicas están en CONTEXTO_CLIENTE. Úsalas exactamente como aparecen.`;

// ==================== RESPUESTAS PREDEFINIDAS ====================
const RESPUESTAS = {
  saludo: {
    espanol: "Hola. Para ayudarle mejor, ¿cuál es su asunto?",
    darija: "السلام عليكم. باش نعاونوك مزيان، شنو القضية ديالك؟",
    frances: "Bonjour. Pour mieux vous aider, quel est votre sujet?",
    ingles: "Hello. To help you better, what is your matter?"
  },
  
  cliente_existente: {
    espanol: "Por favor déjenos su pregunta y le responderemos el próximo día laborable.",
    darija: "عافاك خلي السؤال ديالك وغادي نجاوبوك النهار الجاي ديال الخدمة",
    frances: "Veuillez nous laisser votre question et nous vous répondrons le prochain jour ouvrable.",
    ingles: "Please leave us your question and we will respond the next business day."
  },
  
  // SERVICIOS CON RESOLUCIÓN (Reagrupación, Trabajo, Estudios)
  servicios_resolucion_pregunta: {
    espanol: "Gracias. En este tipo de residencias trabajamos normalmente desde el inicio para evitar incidencias posteriores en el Consulado.\n\nConfírmenos:\n1 Aún no se ha iniciado\n2 Ya tiene resolución\n3 Existe una denegación",
    darija: "شكرا. فهاد النوع ديال الإقامات كنخدمو عادة من البداية باش نتجنبو المشاكل فالقنصلية.\n\nأكد لينا:\n1 مازال ما بداتيش\n2 عندك القرار\n3 كاين رفض",
    frances: "Merci. Pour ce type de résidences, nous travaillons normalement depuis le début pour éviter des incidents au Consulat.\n\nConfirmez-nous:\n1 Pas encore commencé\n2 Vous avez déjà la résolution\n3 Il y a un refus",
    ingles: "Thank you. For this type of residence, we normally work from the beginning to avoid issues at the Consulate.\n\nConfirm:\n1 Not yet started\n2 Already have resolution\n3 There is a denial"
  },
  
  // REAGRUPACIÓN - Opción 1
  reagrupacion_opcion1: {
    espanol: "Perfecto.\n¿Para qué familiar es la solicitud y el reagrupante es residente en España o ciudadano español?",
    darija: "مزيان.\nشكون من العائلة باغي تجمع معاه والشخص اللي غادي يجمع ساكن فإسبانيا ولا مواطن إسباني؟",
    frances: "Parfait.\nPour quel membre de la famille est la demande et le regroupant est-il résident en Espagne ou citoyen espagnol?",
    ingles: "Perfect.\nFor which family member is the application and is the sponsor a resident in Spain or Spanish citizen?"
  },
  
  // TRABAJO/ESTUDIOS - Opción 1
  trabajo_estudios_opcion1: {
    espanol: "Perfecto.\nEn este caso, le contactaremos para iniciar correctamente el procedimiento completo desde España.",
    darija: "مزيان.\nفهاد الحالة، غادي نتصلو بيك باش نبداو الإجراءات كاملة من إسبانيا.",
    frances: "Parfait.\nDans ce cas, nous vous contacterons pour initier correctement la procédure complète depuis l'Espagne.",
    ingles: "Perfect.\nIn this case, we will contact you to properly initiate the complete procedure from Spain."
  },
  
  // Opción 2 (Ya tiene resolución)
  opcion2_resolucion: {
    espanol: "Perfecto.\nEn este caso, le ayudamos a preparar toda la documentación y requisitos del visado, teniendo en cuenta los criterios específicos que aplica cada Consulado.\n\nEl siguiente paso es concertar una cita con el despacho para revisar la resolución y organizar el expediente de visado.",
    darija: "مزيان.\nفهاد الحالة، كنعاونوك باش تحضر جميع الوثائق والمتطلبات ديال الفيزا، وكناخدو بعين الاعتبار المعايير الخاصة لكل قنصلية.\n\nالخطوة الجاية هي نحددو موعد مع المكتب باش نراجعو القرار ونظمو ملف الفيزا.",
    frances: "Parfait.\nDans ce cas, nous vous aidons à préparer toute la documentation et les exigences du visa, en tenant compte des critères spécifiques de chaque Consulat.\n\nLa prochaine étape est de fixer un rendez-vous avec le cabinet pour réviser la résolution et organiser le dossier de visa.",
    ingles: "Perfect.\nIn this case, we help you prepare all documentation and visa requirements, taking into account the specific criteria each Consulate applies.\n\nThe next step is to schedule an appointment with the office to review the resolution and organize the visa file."
  },
  
  // Opción 3 (Denegación)
  opcion3_denegacion: {
    espanol: "De acuerdo.\nEn los casos de denegación es imprescindible analizar la resolución y, si se realizó, la entrevista consular, ya que cada Consulado aplica criterios distintos.\n\nEnvíenos esa documentación para estudiar la viabilidad del recurso, ya sea ante el Consulado, Extranjería o mediante Recurso Contencioso-Administrativo ante el Tribunal Superior de Justicia de Madrid.",
    darija: "واخا.\nفحالات الرفض ضروري نحللو القرار، وإذا كانت، المقابلة القنصلية، حيث كل قنصلية كتطبق معايير مختلفة.\n\nصيفط لينا هاد الوثائق باش ندرسو إمكانية الطعن، سواء قدام القنصلية، الهجرة أو عن طريق الطعن الإداري قدام المحكمة العليا ديال مدريد.",
    frances: "D'accord.\nDans les cas de refus, il est essentiel d'analyser la résolution et, si elle a eu lieu, l'entretien consulaire, car chaque Consulat applique des critères différents.\n\nEnvoyez-nous cette documentation pour étudier la viabilité du recours, que ce soit devant le Consulat, l'Immigration ou par Recours Contentieux-Administratif devant le Tribunal Supérieur de Justice de Madrid.",
    ingles: "Understood.\nIn denial cases, it's essential to analyze the resolution and, if conducted, the consular interview, as each Consulate applies different criteria.\n\nSend us that documentation to study the viability of appeal, whether before the Consulate, Immigration or through Administrative Appeal before the Superior Court of Justice of Madrid."
  },
  
  // RECUPERACIÓN DE TARJETA
  tarjeta_inicio: {
    espanol: "Perfecto.\nPara valorar el inicio del procedimiento, necesitamos que nos indique:\n– Fecha de su última entrada en Marruecos\n– Si ha tenido orden de expulsión\n– Y, si es posible, que nos envíe copia de su tarjeta, para comprobar si se trata de Larga Duración o Larga Duración-UE.",
    darija: "مزيان.\nباش نقدرو نبداو الإجراءات، خاصنا تقول لينا:\n– تاريخ آخر دخول ليك للمغرب\n– واش كان عندك أمر بالطرد\n– وإذا أمكن، صيفط لينا نسخة من البطاقة ديالك، باش نشوفو واش هي لمدة طويلة ولا لمدة طويلة-UE.",
    frances: "Parfait.\nPour évaluer le début de la procédure, nous avons besoin que vous nous indiquiez:\n– Date de votre dernière entrée au Maroc\n– Si vous avez eu un ordre d'expulsion\n– Et, si possible, que vous nous envoyiez une copie de votre carte, pour vérifier s'il s'agit de Longue Durée ou Longue Durée-UE.",
    ingles: "Perfect.\nTo evaluate the start of the procedure, we need you to tell us:\n– Date of your last entry to Morocco\n– If you had an expulsion order\n– And, if possible, send us a copy of your card, to check if it's Long Duration or Long Duration-EU."
  },
  
  tarjeta_denegacion: {
    espanol: "De acuerdo.\nEnvíenos por favor la resolución de denegación, para poder estudiar el caso y valorar la vía adecuada de recurso.",
    darija: "واخا.\nصيفط لينا عافاك قرار الرفض، باش نقدرو ندرسو الحالة ونشوفو الطريقة المناسبة للطعن.",
    frances: "D'accord.\nEnvoyez-nous s'il vous plaît la résolution de refus, pour pouvoir étudier le cas et évaluer la voie de recours appropriée.",
    ingles: "Understood.\nPlease send us the denial resolution, so we can study the case and evaluate the appropriate appeal route."
  },
  
  // RESIDENCIA NO LUCRATIVA
  nolucrativa: {
    espanol: "La Residencia No Lucrativa requiere un análisis completo del expediente.\n\nAunque el dossier financiero es un elemento clave, la experiencia demuestra que el resultado depende de que todo el expediente esté bien estructurado, sea coherente y mantenga una narrativa homogénea, desde el origen de los fondos hasta el proyecto de vida en España.\n\nPor este motivo, en Consulado.Abogado trabajamos preparando el expediente de forma integral, revisando cada una de sus partes para evitar incoherencias que suelen dar lugar a denegaciones consulares.\n\nEl siguiente paso es asignar una cita con el despacho para revisar su documentación y definir correctamente el enfoque de su solicitud.\n\nIndíquenos, por favor, una hora por la mañana (lunes a jueves) en la que podamos contactarle para asignar la cita y continuar con su expediente.",
    darija: "الإقامة الغير المربحة كتتطلب تحليل كامل للملف.\n\nواخا الملف المالي عنصر أساسي، التجربة كتبين أن النتيجة كتعتمد على أن الملف كامل يكون منظم مزيان، ومتماسك وعندو قصة واحدة، من أصل الأموال حتى لمشروع الحياة فإسبانيا.\n\nلهذا السبب، فConsulado.Abogado كنخدمو على تحضير الملف بشكل شامل، كنراجعو كل جزء باش نتجنبو التناقضات اللي عادة كتؤدي لرفض القنصلية.\n\nالخطوة الجاية هي نحددو موعد مع المكتب باش نراجعو الوثائق ديالك ونحددو الطريقة الصحيحة للطلب ديالك.\n\nقول لينا عافاك، وقت فالصباح (الإثنين للخميس) فين نقدرو نتصلو بيك باش نحددو الموعد ونكملو مع الملف ديالك.",
    frances: "La Résidence Non Lucrative nécessite une analyse complète du dossier.\n\nBien que le dossier financier soit un élément clé, l'expérience démontre que le résultat dépend du fait que tout le dossier soit bien structuré, cohérent et maintienne un récit homogène, de l'origine des fonds au projet de vie en Espagne.\n\nPour cette raison, chez Consulado.Abogado nous travaillons en préparant le dossier de manière intégrale, en révisant chacune de ses parties pour éviter des incohérences qui donnent généralement lieu à des refus consulaires.\n\nLa prochaine étape est d'assigner un rendez-vous avec le cabinet pour réviser votre documentation et définir correctement l'approche de votre demande.\n\nIndiquez-nous, s'il vous plaît, une heure le matin (lundi à jeudi) où nous pouvons vous contacter pour assigner le rendez-vous et continuer avec votre dossier.",
    ingles: "Non-Lucrative Residence requires a complete file analysis.\n\nAlthough the financial dossier is a key element, experience shows that the result depends on the entire file being well-structured, coherent and maintaining a homogeneous narrative, from the origin of funds to the life project in Spain.\n\nFor this reason, at Consulado.Abogado we work preparing the file integrally, reviewing each of its parts to avoid inconsistencies that usually lead to consular denials.\n\nThe next step is to assign an appointment with the office to review your documentation and correctly define the approach of your application.\n\nPlease tell us a morning time (Monday to Thursday) when we can contact you to assign the appointment and continue with your file."
  },
  
  // MATRIMONIO
  matrimonio_pregunta: {
    espanol: "Para poder ayudarle correctamente, indíquenos en qué punto se encuentra su situación:\n1️⃣ Aún no he iniciado el procedimiento de Capacidad Matrimonial\n2️⃣ El procedimiento ya está iniciado\n3️⃣ Existe algún problema o denegación\n\nResponda con 1, 2 o 3.",
    darija: "باش نقدرو نعاونوك مزيان، قول لينا فين واصل فالموضوع ديالك:\n1️⃣ مازال ما بديتيش إجراءات الأهلية للزواج\n2️⃣ الإجراءات بدات\n3️⃣ كاين مشكل أو رفض\n\nجاوب ب 1، 2 أو 3.",
    frances: "Pour pouvoir vous aider correctement, indiquez-nous à quel point se trouve votre situation:\n1️⃣ Je n'ai pas encore commencé la procédure de Capacité Matrimoniale\n2️⃣ La procédure est déjà commencée\n3️⃣ Il existe un problème ou un refus\n\nRépondez avec 1, 2 ou 3.",
    ingles: "To help you correctly, tell us at what point your situation is:\n1️⃣ I haven't started the Marriage Capacity procedure yet\n2️⃣ The procedure is already started\n3️⃣ There is a problem or denial\n\nRespond with 1, 2 or 3."
  },
  
  matrimonio_opcion1: {
    espanol: "Perfecto.\nEn este caso, en Consulado.Abogado nos ocupamos de todo el procedimiento desde el inicio:\n– Trámite de Capacidad Matrimonial\n– Celebración del matrimonio\n– Inscripción del matrimonio\n– Y solicitud del visado por reagrupación familiar\n\nAl encargarnos del proceso completo, vamos adelantando trámites para evitar esperas innecesarias entre una fase y otra, con el objetivo de obtener el visado de reagrupación familiar con su pareja en el menor tiempo posible.\n\nEl siguiente paso es asignar una cita con el despacho para organizar correctamente el procedimiento.",
    darija: "مزيان.\nفهاد الحالة، فConsulado.Abogado كنتكلفو بجميع الإجراءات من البداية:\n– إجراءات الأهلية للزواج\n– الاحتفال بالزواج\n– تسجيل الزواج\n– وطلب الفيزا للم الشمل العائلي\n\nملي كنتكلفو بالعملية كاملة، كنمشيو نقدمو الإجراءات باش نتجنبو الانتظار بين مرحلة ومرحلة، بهدف الحصول على فيزا لم الشمل العائلي مع الشريك ديالك فأقصر وقت.\n\nالخطوة الجاية هي نحددو موعد مع المكتب باش ننظمو الإجراءات مزيان.",
    frances: "Parfait.\nDans ce cas, chez Consulado.Abogado nous nous occupons de toute la procédure depuis le début:\n– Démarche de Capacité Matrimoniale\n– Célébration du mariage\n– Inscription du mariage\n– Et demande de visa pour regroupement familial\n\nEn nous chargeant du processus complet, nous avançons les démarches pour éviter des attentes inutiles entre une phase et une autre, dans le but d'obtenir le visa de regroupement familial avec votre partenaire dans les plus brefs délais.\n\nLa prochaine étape est d'assigner un rendez-vous avec le cabinet pour organiser correctement la procédure.",
    ingles: "Perfect.\nIn this case, at Consulado.Abogado we handle the entire procedure from the beginning:\n– Marriage Capacity procedure\n– Marriage celebration\n– Marriage registration\n– And family reunification visa application\n\nBy handling the complete process, we advance procedures to avoid unnecessary waits between phases, with the goal of obtaining the family reunification visa with your partner in the shortest time possible.\n\nThe next step is to assign an appointment with the office to properly organize the procedure."
  },
  
  matrimonio_opcion2: {
    espanol: "De acuerdo.\nIndíquenos desde qué fase se encuentra el procedimiento y, si dispone de documentación, envíenosla para poder valorar cómo continuar sin retrasos innecesarios.",
    darija: "واخا.\nقول لينا من أية مرحلة واصل الإجراء، وإذا عندك وثائق، صيفطهم لينا باش نقدرو نشوفو كيفاش نكملو بلا تأخير.",
    frances: "D'accord.\nIndiquez-nous à quelle phase se trouve la procédure et, si vous disposez de documentation, envoyez-la nous pour pouvoir évaluer comment continuer sans retards inutiles.",
    ingles: "Understood.\nTell us from which phase the procedure is and, if you have documentation, send it to us so we can evaluate how to continue without unnecessary delays."
  },
  
  matrimonio_opcion3: {
    espanol: "Envíenos, por favor, la resolución o documentación disponible, para poder estudiar su situación y valorar la vía adecuada para continuar el procedimiento.",
    darija: "صيفط لينا عافاك، القرار أو الوثائق اللي عندك، باش نقدرو ندرسو الحالة ديالك ونشوفو الطريقة المناسبة باش نكملو الإجراءات.",
    frances: "Envoyez-nous, s'il vous plaît, la résolution ou la documentation disponible, pour pouvoir étudier votre situation et évaluer la voie appropriée pour continuer la procédure.",
    ingles: "Please send us the resolution or available documentation, so we can study your situation and evaluate the appropriate way to continue the procedure."
  },
  
  // NACIONALIDAD/INSCRIPCIÓN
  nacionalidad_pregunta: {
    espanol: "Para poder orientarle correctamente, indíquenos qué trámite desea realizar:\n1️⃣ Nacionalidad española de un adulto\n2️⃣ Inscripción de hijos españoles y obtención de pasaportes\n\nResponda con 1 o 2.",
    darija: "باش نقدرو نوجهوك مزيان، قول لينا شنو الإجراء اللي بغيتي دير:\n1️⃣ الجنسية الإسبانية لشخص بالغ\n2️⃣ تسجيل الأولاد الإسبان والحصول على جوازات السفر\n\nجاوب ب 1 أو 2.",
    frances: "Pour pouvoir vous orienter correctement, indiquez-nous quelle démarche vous souhaitez réaliser:\n1️⃣ Nationalité espagnole d'un adulte\n2️⃣ Inscription d'enfants espagnols et obtention de passeports\n\nRépondez avec 1 ou 2.",
    ingles: "To guide you correctly, tell us which procedure you want to do:\n1️⃣ Spanish nationality for an adult\n2️⃣ Registration of Spanish children and obtaining passports\n\nRespond with 1 or 2."
  },
  
  nacionalidad_opcion1: {
    espanol: "Perfecto.\nEn este caso, el siguiente paso es asignar una cita con el despacho para analizar su situación y explicarle el procedimiento adecuado para iniciar la solicitud de nacionalidad.",
    darija: "مزيان.\nفهاد الحالة، الخطوة الجاية هي نحددو موعد مع المكتب باش نحللو الوضعية ديالك ونشرحو ليك الإجراءات المناسبة باش تبدا طلب الجنسية.",
    frances: "Parfait.\nDans ce cas, la prochaine étape est d'assigner un rendez-vous avec le cabinet pour analyser votre situation et vous expliquer la procédure appropriée pour initier la demande de nationalité.",
    ingles: "Perfect.\nIn this case, the next step is to assign an appointment with the office to analyze your situation and explain the appropriate procedure to initiate the nationality application."
  },
  
  nacionalidad_opcion2: {
    espanol: "De acuerdo.\nPara poder estudiar el caso y confirmar el procedimiento correcto, necesitamos que nos envíe la certificación literal de nacimiento del padre o de la madre de nacionalidad española.\n\nCon esa documentación podremos valorar la inscripción de los hijos y derivar el asunto a entrevista, si procede, para continuar con el trámite y la obtención de los pasaportes.",
    darija: "واخا.\nباش نقدرو ندرسو الحالة ونأكدو الإجراءات الصحيحة، خاصنا تصيفط لينا شهادة الميلاد الكاملة ديال الأب أو الأم الإسباني.\n\nبهاد الوثائق نقدرو نقيمو تسجيل الأولاد ونوجهو الموضوع للمقابلة، إذا كان ضروري، باش نكملو الإجراءات والحصول على جوازات السفر.",
    frances: "D'accord.\nPour pouvoir étudier le cas et confirmer la procédure correcte, nous avons besoin que vous nous envoyiez la certification littérale de naissance du père ou de la mère de nationalité espagnole.\n\nAvec cette documentation nous pourrons évaluer l'inscription des enfants et dériver l'affaire à un entretien, si nécessaire, pour continuer avec la démarche et l'obtention des passeports.",
    ingles: "Understood.\nTo study the case and confirm the correct procedure, we need you to send us the literal birth certificate of the father or mother of Spanish nationality.\n\nWith that documentation we can evaluate the registration of the children and refer the matter to interview, if appropriate, to continue with the procedure and obtaining passports."
  },
  
  // CANCELACIÓN ANTECEDENTES
  penales: {
    espanol: "Para poder valorar correctamente la cancelación de antecedentes, es necesario solicitar previamente el certificado de antecedentes penales.\n\nA la vista de lo que figure en dicho certificado, podremos indicarle el plazo y el coste de la cancelación, ya que dependen del tipo de antecedentes y de su antigüedad.\n\nAdemás, en Consulado.Abogado tramitamos también la cancelación de antecedentes policiales y de la Guardia Civil, lo cual es muy aconsejable en procedimientos de residencia, incluso cuando los antecedentes penales ya han sido cancelados.\n\nPara continuar, el siguiente paso es asignar una cita con el despacho una vez disponga del certificado de antecedentes penales.",
    darija: "باش نقدرو نقيمو مزيان إلغاء السوابق، ضروري نطلبو أولا شهادة السوابق الجنائية.\n\nملي نشوفو شنو كاين فالشهادة، نقدرو نقولو ليك المدة والتكلفة ديال الإلغاء، حيث كيعتمدو على نوع السوابق والقدم ديالها.\n\nبالإضافة لهذا، فConsulado.Abogado كنعالجو أيضا إلغاء السوابق البوليسية وديال الحرس المدني، وهذا مستحسن بزاف فإجراءات الإقامة، حتى إذا كانت السوابق الجنائية تم إلغاؤها.\n\nباش نكملو، الخطوة الجاية هي نحددو موعد مع المكتب ملي يكون عندك شهادة السوابق الجنائية.",
    frances: "Pour pouvoir évaluer correctement l'annulation des antécédents, il est nécessaire de demander préalablement le certificat d'antécédents pénaux.\n\nÀ la vue de ce qui figure dans ledit certificat, nous pourrons vous indiquer le délai et le coût de l'annulation, car ils dépendent du type d'antécédents et de leur ancienneté.\n\nDe plus, chez Consulado.Abogado nous traitons également l'annulation des antécédents policiers et de la Garde Civile, ce qui est très conseillé dans les procédures de résidence, même lorsque les antécédents pénaux ont déjà été annulés.\n\nPour continuer, la prochaine étape est d'assigner un rendez-vous avec le cabinet une fois que vous disposerez du certificat d'antécédents pénaux.",
    ingles: "To properly evaluate the cancellation of records, it's necessary to previously request the criminal record certificate.\n\nIn view of what appears in said certificate, we can tell you the timeframe and cost of cancellation, as they depend on the type of records and their age.\n\nAdditionally, at Consulado.Abogado we also process the cancellation of police and Civil Guard records, which is highly advisable in residence procedures, even when criminal records have already been cancelled.\n\nTo continue, the next step is to assign an appointment with the office once you have the criminal record certificate."
  },
  
  // OTROS CASOS
  otros_casos: {
    espanol: "Si su consulta no encaja exactamente en ninguno de los servicios indicados, puede explicarnos brevemente su caso o, si le resulta más cómodo, enviarnos un audio.\n\nEn Consulado.Abogado trabajamos todo tipo de expedientes de Extranjería, con una especialización muy concreta en procedimientos ante los Consulados, que es donde se concentran la mayoría de las incidencias y denegaciones.\n\nPor eso, no dude en explicarnos su situación. Queremos ayudarle y sabemos que podemos hacerlo, porque estamos acostumbrados a resolver casos complejos que requieren experiencia y criterio jurídico.\n\nSi dispone de documentación, puede adjuntarla para que podamos revisarla previamente.\n\nPara poder darle una respuesta adecuada en cita con el abogado, indíquenos por favor un día y una hora en la que esté disponible, de lunes a jueves por la mañana, entre las 9:00 y las 14:00, para poder contactarle.",
    darija: "إذا كان السؤال ديالك ما كيدخلش بالضبط فأي خدمة من اللي قلنا، تقدر تشرح لينا الحالة ديالك باختصار، أو إذا كان أسهل ليك، صيفط لينا صوت.\n\nفConsulado.Abogado كنخدمو جميع أنواع ملفات الهجرة، مع تخصص دقيق فالإجراءات قدام القنصليات، اللي هو فين كتركز أغلب المشاكل والرفض.\n\nلهذا، ما تترددش تشرح لينا الوضعية ديالك. بغينا نعاونوك وعارفين أننا نقدرو، حيت معودين نحلو حالات معقدة اللي كتطلب تجربة وحكم قانوني.\n\nإذا عندك وثائق، تقدر تصيفطها باش نراجعوها قبل.\n\nباش نقدرو نعطيوك جواب مناسب فموعد مع المحامي، قول لينا عافاك نهار ووقت فين تكون متفرغ، من الإثنين للخميس الصباح، بين 9:00 و 14:00، باش نقدرو نتصلو بيك.",
    frances: "Si votre consultation ne correspond pas exactement à l'un des services indiqués, vous pouvez nous expliquer brièvement votre cas ou, si c'est plus confortable pour vous, nous envoyer un audio.\n\nChez Consulado.Abogado nous travaillons tout type de dossiers d'Immigration, avec une spécialisation très concrète dans les procédures devant les Consulats, qui est où se concentrent la majorité des incidents et refus.\n\nPour cela, n'hésitez pas à nous expliquer votre situation. Nous voulons vous aider et nous savons que nous pouvons le faire, parce que nous sommes habitués à résoudre des cas complexes qui nécessitent expérience et jugement juridique.\n\nSi vous disposez de documentation, vous pouvez la joindre pour que nous puissions la réviser préalablement.\n\nPour pouvoir vous donner une réponse adéquate lors du rendez-vous avec l'avocat, indiquez-nous s'il vous plaît un jour et une heure où vous êtes disponible, du lundi au jeudi matin, entre 9h00 et 14h00, pour pouvoir vous contacter.",
    ingles: "If your consultation doesn't exactly fit any of the indicated services, you can briefly explain your case to us or, if it's more comfortable for you, send us an audio.\n\nAt Consulado.Abogado we work all types of Immigration files, with a very specific specialization in procedures before Consulates, which is where most incidents and denials are concentrated.\n\nTherefore, don't hesitate to explain your situation to us. We want to help you and we know we can do it, because we're used to solving complex cases that require experience and legal judgment.\n\nIf you have documentation, you can attach it so we can review it beforehand.\n\nTo be able to give you an adequate response in appointment with the lawyer, please tell us a day and time when you're available, Monday to Thursday morning, between 9:00 and 14:00, so we can contact you."
  },
  
  // CIERRE CON GUÍAS
  cierre_con_guias: {
    espanol: "\n\nMientras llega el día de la entrevista con nuestro abogado, donde le podrá dar una respuesta más específica a su caso, puede usted consultar nuestras guías y descargarse los formularios en consulado.abogado\n\nIndíquenos, por favor, una hora por la mañana (lunes a jueves) en la que podamos contactarle para asignar la cita y continuar con su expediente.",
    darija: "\n\nحتى يجي نهار اللقاء مع المحامي ديالنا، فين غادي يقدر يعطيك جواب أكثر تحديدا للحالة ديالك، تقدر تشوف الأدلة ديالنا وتحمل النماذج من consulado.abogado\n\nقول لينا عافاك، وقت فالصباح (الإثنين للخميس) فين نقدرو نتصلو بيك باش نحددو الموعد ونكملو مع الملف ديالك.",
    frances: "\n\nEn attendant le jour de l'entretien avec notre avocat, où il pourra vous donner une réponse plus spécifique à votre cas, vous pouvez consulter nos guides et télécharger les formulaires sur consulado.abogado\n\nIndiquez-nous, s'il vous plaît, une heure le matin (lundi à jeudi) où nous pouvons vous contacter pour assigner le rendez-vous et continuer avec votre dossier.",
    ingles: "\n\nWhile waiting for the interview day with our lawyer, where they can give you a more specific answer to your case, you can check our guides and download forms at consulado.abogado\n\nPlease tell us a morning time (Monday to Thursday) when we can contact you to assign the appointment and continue with your file."
  },
  
  cierre_tarjeta: {
    espanol: "\n\nCon esta información podremos indicarle cómo proceder y asumir la gestión del expediente, en su caso.",
    darija: "\n\nبهاد المعلومات نقدرو نقولو ليك كيفاش نمشيو ونتكلفو بتدبير الملف، حسب الحالة.",
    frances: "\n\nAvec ces informations nous pourrons vous indiquer comment procéder et assumer la gestion du dossier, le cas échéant.",
    ingles: "\n\nWith this information we can tell you how to proceed and assume management of the file, if applicable."
  }
};

// ==================== WEBHOOK WHATSAPP ====================
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const mensajeEntrante = req.body.Body || '';
    const telefonoCliente = req.body.From;
    
    console.log(`📨 Mensaje de ${telefonoCliente}: ${mensajeEntrante}`);
    
    // Obtener o crear cliente
    const cliente = await obtenerCliente(telefonoCliente);
    const numConversaciones = await contarConversaciones(telefonoCliente);
    
    // Si es cliente existente (más de 5 conversaciones previas)
    if (numConversaciones > 5) {
      await actualizarCliente(telefonoCliente, { es_cliente_existente: 1 });
      const idioma = detectarIdioma(mensajeEntrante) || cliente.idioma || 'espanol';
      const respuesta = RESPUESTAS.cliente_existente[idioma];
      
      await guardarConversacion(telefonoCliente, mensajeEntrante, respuesta, idioma, null, 'cliente_existente');
      await twilioClient.messages.create({
        body: respuesta,
        from: CONFIG.TWILIO_WHATSAPP_NUMBER,
        to: telefonoCliente
      });
      
      res.status(200).send('OK');
      return;
    }
    
    // Detectar idioma y servicio
    const idiomaDetectado = detectarIdioma(mensajeEntrante);
    const servicioDetectado = detectarServicio(mensajeEntrante);
    
    // Actualizar cliente si detectamos nuevo idioma o servicio
    const actualizaciones = {};
    if (idiomaDetectado && idiomaDetectado !== cliente.idioma) {
      actualizaciones.idioma = idiomaDetectado;
    }
    if (servicioDetectado && servicioDetectado !== cliente.servicio) {
      actualizaciones.servicio = servicioDetectado;
      actualizaciones.etapa = 'servicio_detectado';
    }
    if (Object.keys(actualizaciones).length > 0) {
      await actualizarCliente(telefonoCliente, actualizaciones);
    }
    
    const idioma = idiomaDetectado || cliente.idioma || 'espanol';
    const servicio = servicioDetectado || cliente.servicio;
    
    // Construir contexto para Claude
    let contexto = `
INFORMACIÓN DEL CLIENTE:
- Teléfono: ${telefonoCliente}
- Idioma detectado: ${idioma}
- Servicio detectado: ${servicio || 'ninguno'}
- Etapa actual: ${cliente.etapa || 'inicial'}
- Número de conversaciones previas: ${numConversaciones}
- Es cliente existente: ${cliente.es_cliente_existente ? 'Sí' : 'No'}

RESPUESTAS PREDEFINIDAS DISPONIBLES:
${JSON.stringify(RESPUESTAS, null, 2)}

INSTRUCCIONES:
1. Si es saludo simple (hola, buenos días, salam, etc): usa RESPUESTAS.saludo[${idioma}]
2. Si detectaste un servicio específico, usa la respuesta correspondiente
3. Si el cliente responde con número (1, 2, 3), identifica de qué servicio viene y da la respuesta completa correspondiente
4. IMPORTANTE: Las respuestas largas de cada opción (opcion1, opcion2, opcion3, etc) deben darse COMPLETAS tal como están en RESPUESTAS
5. Añade el cierre con guías cuando corresponda
6. Responde SOLO en ${idioma}
7. NO uses emojis
8. Sé directo y profesional
`;
    
    // Obtener historial
    const historial = await obtenerHistorial(telefonoCliente);
    const mensajes = [
      ...historial,
      { role: 'user', content: mensajeEntrante + '\n\n' + contexto }
    ];
    
    // Llamar a Claude
    const respuestaClaude = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: mensajes
    });
    
    const textoRespuesta = respuestaClaude.content[0].text;
    
    // Guardar conversación
    await guardarConversacion(telefonoCliente, mensajeEntrante, textoRespuesta, idioma, servicio, cliente.etapa);
    
    // Enviar respuesta por WhatsApp
    await twilioClient.messages.create({
      body: textoRespuesta,
      from: CONFIG.TWILIO_WHATSAPP_NUMBER,
      to: telefonoCliente
    });
    
    console.log(`✅ Respuesta enviada a ${telefonoCliente}`);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send('Error procesando mensaje');
  }
});

// ==================== PANEL DE ADMINISTRACIÓN ====================
app.get('/admin', (req, res) => {
  db.all('SELECT * FROM clientes ORDER BY ultima_actualizacion DESC LIMIT 100', (err, clientes) => {
    if (err) {
      res.status(500).send('Error');
      return;
    }
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Panel Admin - Consulado.Abogado</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: #f5f5f5;
            padding: 20px;
          }
          .container { max-width: 1400px; margin: 0 auto; }
          h1 { 
            color: #2c3e50;
            margin-bottom: 10px;
            font-size: 28px;
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
          }
          .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #3498db;
          }
          .stat-label {
            color: #7f8c8d;
            margin-top: 5px;
          }
          table {
            width: 100%;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ecf0f1;
          }
          th {
            background: #34495e;
            color: white;
            font-weight: 600;
            position: sticky;
            top: 0;
          }
          tr:hover { background: #f8f9fa; }
          .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
          }
          .badge-si { background: #2ecc71; color: white; }
          .badge-no { background: #e74c3c; color: white; }
          .badge-servicio { background: #3498db; color: white; }
          .badge-idioma { background: #9b59b6; color: white; }
          .telefono { font-family: monospace; color: #2c3e50; }
          .fecha { color: #7f8c8d; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📊 Panel de Administración - Consulado.Abogado</h1>
          <p style="color: #7f8c8d; margin-bottom: 20px;">Sistema de gestión de consultas WhatsApp</p>
          
          <div class="stats">
            <div class="stat-card">
              <div class="stat-number">${clientes.length}</div>
              <div class="stat-label">Total Clientes</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${clientes.filter(c => c.cita_solicitada).length}</div>
              <div class="stat-label">Citas Solicitadas</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${clientes.filter(c => c.documentos_enviados).length}</div>
              <div class="stat-label">Documentos Enviados</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${clientes.filter(c => c.es_cliente_existente).length}</div>
              <div class="stat-label">Clientes Existentes</div>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Teléfono</th>
                <th>Nombre</th>
                <th>Servicio</th>
                <th>Idioma</th>
                <th>Etapa</th>
                <th>Opción</th>
                <th>Docs</th>
                <th>Cita</th>
                <th>Cliente</th>
                <th>Última Actualización</th>
              </tr>
            </thead>
            <tbody>
    `;
    
    clientes.forEach(c => {
      html += `
        <tr>
          <td class="telefono">${c.telefono}</td>
          <td>${c.nombre || '-'}</td>
          <td>${c.servicio ? `<span class="badge badge-servicio">${c.servicio}</span>` : '-'}</td>
          <td>${c.idioma ? `<span class="badge badge-idioma">${c.idioma}</span>` : '-'}</td>
          <td>${c.etapa || '-'}</td>
          <td>${c.opcion_seleccionada || '-'}</td>
          <td>${c.documentos_enviados ? '<span class="badge badge-si">Sí</span>' : '<span class="badge badge-no">No</span>'}</td>
          <td>${c.cita_solicitada ? '<span class="badge badge-si">Sí</span>' : '<span class="badge badge-no">No</span>'}</td>
          <td>${c.es_cliente_existente ? '<span class="badge badge-si">Sí</span>' : '<span class="badge badge-no">No</span>'}</td>
          <td class="fecha">${new Date(c.ultima_actualizacion).toLocaleString('es-ES')}</td>
        </tr>
      `;
    });
    
    html += `
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;
    
    res.send(html);
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Consulado.Abogado WhatsApp Assistant'
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Consulado.Abogado - WhatsApp Assistant</title></head>
      <body style="font-family: Arial; padding: 40px; text-align: center;">
        <h1>✅ Sistema WhatsApp Activo</h1>
        <p>Asistente automático para Consulado.Abogado</p>
        <p><a href="/admin" style="color: #3498db;">Panel de Administración</a></p>
      </body>
    </html>
  `);
});

// ==================== INICIAR SERVIDOR ====================
app.listen(CONFIG.PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ✅  SERVIDOR INICIADO CORRECTAMENTE                     ║
║                                                           ║
║   📱 Asistente WhatsApp: Consulado.Abogado               ║
║   🌐 Puerto: ${CONFIG.PORT}                                        ║
║   📞 WhatsApp: ${CONFIG.TWILIO_WHATSAPP_NUMBER}          ║
║   👤 Panel Admin: http://localhost:${CONFIG.PORT}/admin          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Manejo de errores
process.on('unhandledRejection', (error) => {
  console.error('❌ Error no manejado:', error);
});
