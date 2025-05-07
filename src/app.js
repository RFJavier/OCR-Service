const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { checkTesseractInstallation } = require('./processors/ocr');

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Asegurar que existe el directorio de uploads
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Rutas
app.use('/api', require('./routes'));

// Ruta de salud/estado
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'ocr-service'
  });
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`Servidor OCR corriendo en http://localhost:${PORT}`);
  
  // Verificar que Tesseract está disponible
  const tesseractAvailable = await checkTesseractInstallation();
  if (tesseractAvailable) {
    console.log('✅ Tesseract OCR encontrado en el PATH del sistema');
  } else {
    console.error('❌ Tesseract OCR no disponible - el servicio OCR no funcionará correctamente');
  }
});

module.exports = app;