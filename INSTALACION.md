# GUÍA DE INSTALACIÓN - ASISTENTE WHATSAPP CONSULADO.ABOGADO
## Versión 2.0 - Con Flujos Conversacionales Completos

---

## 📋 REQUISITOS PREVIOS

✅ Cuenta Twilio activada
✅ Cuenta Anthropic (Claude API) activada
✅ VPS con Plesk
✅ Node.js 18+ instalado en Plesk

---

## 🚀 PASO 1: SUBIR ARCHIVOS A PLESK

### 1.1 Acceder al File Manager

1. Entra en Plesk
2. Selecciona tu dominio **consulado.abogado**
3. Haz clic en **"File Manager"** o **"Administrador de archivos"**

### 1.2 Crear la carpeta del asistente

1. En el File Manager, navega FUERA de `httpdocs`
2. Deberías estar en el directorio principal que contiene:
   ```
   - httpdocs/
   - logs/
   - error_docs/
   - etc.
   ```
3. Haz clic en **"+ Nueva carpeta"** o **"Create Directory"**
4. Nombra la carpeta: **asistente-whatsapp**
5. Entra en esa carpeta

### 1.3 Subir los archivos

Sube estos DOS archivos a la carpeta `asistente-whatsapp`:
- ✅ `server.js`
- ✅ `package.json`

---

## ⚙️ PASO 2: INSTALAR NODE.JS EN PLESK

### 2.1 Activar Node.js

1. En el menú lateral de Plesk, busca **"Node.js"**
2. Si no está instalado:
   - Ve a **"Extensiones"** o **"Extensions"**
   - Busca **"Node.js"**
   - Haz clic en **"Instalar"**

### 2.2 Configurar Node.js para tu dominio

1. Una vez instalado Node.js, ve a la sección **"Node.js"**
2. Haz clic en **"Enable Node.js"** o **"Activar Node.js"**
3. Configura:
   - **Versión Node.js:** Selecciona **18.x o 20.x** (la más reciente disponible)
   - **Modo:** **Production**
   - **Directorio de la aplicación:** `/asistente-whatsapp`
   - **Archivo de inicio:** `server.js`
   - **Puerto de aplicación:** `3000`

---

## 📦 PASO 3: INSTALAR DEPENDENCIAS (NPM INSTALL)

### Opción A: Desde interfaz de Plesk

1. En la sección Node.js, busca el botón **"NPM Install"** o **"Instalar dependencias"**
2. Haz clic y espera a que se instalen todas las dependencias
3. Verifica que no haya errores en los logs

### Opción B: Desde SSH (si tienes acceso)

```bash
cd /var/www/vhosts/consulado.abogado/asistente-whatsapp
npm install
```

---

## 🌐 PASO 4: CONFIGURAR PROXY REVERSO

Para que el asistente sea accesible desde internet, necesitas configurar un proxy.

### Opción A: Configurar Proxy en Apache/Nginx Settings

1. Ve a **"Apache & nginx Settings"** de consulado.abogado
2. En **"Additional directives for HTTP"** añade:

```apache
ProxyPass /whatsapp http://localhost:3000/webhook/whatsapp
ProxyPassReverse /whatsapp http://localhost:3000/webhook/whatsapp

ProxyPass /admin http://localhost:3000/admin
ProxyPassReverse /admin http://localhost:3000/admin
```

3. Guarda cambios
4. Espera a que Apache/Nginx se recargue

### Opción B: Crear Subdominio (alternativa)

Si prefieres usar un subdominio tipo `api.consulado.abogado`:

1. Crea el subdominio en Plesk
2. Configura que apunte al puerto 3000
3. Tu URL sería: `https://api.consulado.abogado/webhook/whatsapp`

---

## ▶️ PASO 5: INICIAR EL SERVIDOR

1. En Plesk Node.js, haz clic en **"Start"** o **"Iniciar aplicación"**
2. Verifica que el estado sea **"Running"** o **"En ejecución"**
3. Si hay errores:
   - Ve a **"Logs"** o **"Registros"**
   - Lee el error y corrígelo
   - Reinicia la aplicación

---

## 📞 PASO 6: CONFIGURAR WEBHOOK EN TWILIO

### 6.1 Acceder a configuración de WhatsApp

1. Ve a https://console.twilio.com
2. Navega a **Messaging → Try it out → Send a WhatsApp message**
3. Haz clic en **"Sandbox settings"** o **"Configuración del Sandbox"**

### 6.2 Configurar el Webhook

En la sección **"When a message comes in"**:

1. **URL del Webhook:**
   - Si usaste proxy: `https://consulado.abogado/whatsapp`
   - Si usaste subdominio: `https://api.consulado.abogado/webhook/whatsapp`

2. **Método HTTP:** Selecciona **POST**

3. Guarda los cambios

---

## ✅ PASO 7: PROBAR EL SISTEMA

### 7.1 Conectarte al Sandbox de Twilio

1. Twilio te muestra un código para conectarte
2. Envía un WhatsApp al número de Twilio: **+1 415 523 8886**
3. El mensaje debe ser: `join [código-que-te-dan]`
4. Recibirás confirmación de conexión

### 7.2 Probar el asistente

Envía mensajes de prueba:

**Español:**
```
Hola
```
Deberías recibir: "Hola. Para ayudarle mejor, ¿cuál es su asunto?"

**Darija:**
```
سلام
```
Deberías recibir respuesta en darija.

**Prueba de servicio:**
```
Necesito reagrupación familiar
```
Deberías recibir las opciones 1, 2, 3.

---

## 👤 PASO 8: ACCEDER AL PANEL DE ADMINISTRACIÓN

Abre tu navegador y ve a:
- Si usaste proxy: `https://consulado.abogado/admin`
- Si usaste subdominio: `https://api.consulado.abogado/admin`

Verás:
- Total de clientes
- Conversaciones
- Servicios solicitados
- Estado de documentos
- Citas programadas

---

## 🔒 PASO 9: SEGURIDAD (IMPORTANTE)

### 9.1 Proteger el panel /admin

El panel está actualmente SIN CONTRASEÑA. Opciones:

**Opción A: Protección con .htaccess**

Crea archivo `.htaccess` en la carpeta del asistente con autenticación básica.

**Opción B: Modificar el código**

Añadir autenticación en el código (recomendado para producción).

### 9.2 HTTPS

Plesk gestiona automáticamente SSL/HTTPS con Let's Encrypt.
Verifica que tu dominio tenga certificado SSL activo.

---

## 🐛 SOLUCIÓN DE PROBLEMAS

### El servidor no arranca

1. Revisa logs en Plesk Node.js
2. Verifica que Node.js 18+ esté instalado
3. Comprueba que `npm install` se ejecutó sin errores
4. Verifica permisos de la carpeta

### No recibe mensajes de WhatsApp

1. Verifica que el webhook en Twilio esté correcto
2. Comprueba que la URL sea accesible desde internet (prueba en navegador)
3. Revisa que el puerto 3000 no esté bloqueado
4. Mira los logs del servidor para ver si llegan las peticiones

### Error de base de datos

- El archivo `conversaciones.db` se crea automáticamente
- Verifica permisos de escritura en `/asistente-whatsapp`

### Claude no responde correctamente

- Verifica que la API Key de Anthropic sea correcta
- Revisa los logs del servidor
- Comprueba que tienes crédito en Anthropic

---

## 📊 MONITOREO

### Ver logs en tiempo real

En Plesk Node.js:
1. Ve a **"Logs"** o **"Registros"**
2. Selecciona **"Error log"** y **"Output log"**
3. Actualiza para ver mensajes en tiempo real

### Estadísticas

El panel `/admin` te muestra:
- Conversaciones por idioma
- Servicios más solicitados
- Tasa de conversión a citas
- Clientes que enviaron documentos

---

## 🔄 ACTUALIZAR EL SISTEMA

Si haces cambios en `server.js`:

1. Sube el archivo actualizado via FTP/File Manager
2. En Plesk Node.js, haz clic en **"Restart"** o **"Reiniciar"**
3. Verifica los logs para confirmar que arrancó correctamente

---

## 📝 PERSONALIZACIÓN

### Modificar respuestas

Todas las respuestas están en el objeto `RESPUESTAS` dentro de `server.js`.

Puedes editar:
- Textos de cada servicio
- Flujos conversacionales
- Preguntas específicas
- Cierres y llamadas a la acción

### Añadir nuevos servicios

1. Añade detección en función `detectarServicio()`
2. Crea las respuestas en objeto `RESPUESTAS`
3. Reinicia el servidor

---

## 💰 COSTES MENSUALES ESTIMADOS

Con ~90 consultas/mes (3 al día):

- **Twilio WhatsApp:** 2-5€
- **Anthropic API:** 2-5€
- **TOTAL:** 4-10€/mes

Muy económico considerando cada consulta que captes puede generar 30€+ en ingresos.

---

## ✨ CARACTERÍSTICAS DEL SISTEMA

✅ Respuestas en 4 idiomas (Español, Darija, Francés, Inglés)
✅ Detección automática de idioma
✅ 9 servicios diferentes con flujos personalizados
✅ Gestión de clientes existentes
✅ Base de datos SQLite local
✅ Panel de administración web
✅ Totalmente personalizable
✅ Escalable (hasta cientos de conversaciones diarias)

---

## 📞 SOPORTE

Si tienes problemas:

1. Revisa esta guía paso a paso
2. Consulta los logs del servidor
3. Verifica configuración de Twilio
4. Comprueba que las APIs funcionen

Para modificaciones o mejoras, el código es completamente editable y está comentado para facilitar cambios.

---

**¡Buen trabajo! El asistente está listo para convertir visitantes en clientes.**
