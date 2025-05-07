const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processImage, processPDF } = require('../processors/ocr');

const router = express.Router();

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/tiff', 'image/bmp',
    'application/pdf'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no soportado. Formatos permitidos: JPEG, PNG, TIFF, BMP, PDF'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB máximo
});

// Endpoint para OCR
router.post('/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No se proporcionó ningún archivo' 
      });
    }

    const filePath = req.file.path;
    const fileExt = path.extname(filePath).toLowerCase();
    
    let result;
    if (fileExt === '.pdf') {
      result = await processPDF(filePath);
    } else {
      result = await processImage(filePath);
    }
    
    // Limpiar archivo temporal
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.warn('No se pudo eliminar el archivo temporal:', err.message);
    }
    
    return res.status(200).json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error en el procesamiento OCR:', error);
    
    // Limpiar archivo si existe
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.warn('No se pudo eliminar el archivo temporal:', err.message);
      }
    }
    
    return res.status(500).json({
      success: false,
      error: 'Error procesando el documento',
      message: error.message
    });
  }
});

module.exports = router;