const { createWorker, createScheduler } = require('tesseract.js');
const { execSync, exec } = require('child_process');
const dotenv = require('dotenv');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execPromise = util.promisify(exec);

// Rutas a los ejecutables
const TESSERACT_PATH = process.env.TESSERACT_PATH || ''; // Cambia esta ruta según tu instalación
const PDFTOPPM_PATH = process.env.PDFTOPPM_PATH || ''; // Cambia esta ruta según tu instalación

// Perfiles de configuración OCR para distintos tipos de documentos
const OCR_PROFILES = {
  // Perfil por defecto para documentos generales
  general: {
    lang: 'spa',
    engineMode: '3',
    pageSegMode: '6',
    parameters: {
      tessedit_ocr_engine_mode: '3',
      tessedit_pageseg_mode: '6'
    }
  },
  
  // Para documentos con texto denso bien formateado (libros, artículos)
  document: {
    lang: 'spa',
    engineMode: '3', 
    pageSegMode: '3',
    parameters: {
      tessedit_ocr_engine_mode: '3',
      tessedit_pageseg_mode: '3',
      textord_min_linesize: '2.5'
    }
  },
  
  // Para facturas y documentos con tablas
  invoice: {
    lang: 'spa',
    engineMode: '3',
    pageSegMode: '3',
    parameters: {
      tessedit_ocr_engine_mode: '3',
      tessedit_pageseg_mode: '3',
      textord_tabfind_find_tables: '1',
      textord_tablefind_recognize_tables: '1',
      numeric_punctuation: '.,'
    },
    pdfOptions: {
      resolution: 300,
      grayscale: true
    }
  },
  
  // Para capturas de números y códigos
  numbers: {
    lang: 'eng',
    engineMode: '3',
    pageSegMode: '7',
    parameters: {
      tessedit_ocr_engine_mode: '3',
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: '0123456789-_.:/'
    }
  },
  
  // Para documentos en múltiples idiomas
  multilang: {
    lang: 'spa+eng',
    engineMode: '3',
    pageSegMode: '3',
    parameters: {
      tessedit_ocr_engine_mode: '3',
      tessedit_pageseg_mode: '3'
    }
  }
};

// Verificar instalación de Tesseract
async function checkTesseractInstallation() {
  try {
    const { stdout } = await execPromise(`"${TESSERACT_PATH}" --version`);
    console.log('Tesseract instalado:', stdout.split('\n')[0]);
    return true;
  } catch (error) {
    console.error('Error verificando Tesseract:', error.message);
    return false;
  }
}

// Procesar imagen con Tesseract usando un perfil específico
async function processImage(imagePath, profileName = 'general') {
  const profile = OCR_PROFILES[profileName] || OCR_PROFILES.general;
  
  // Crear un worker de Tesseract
  const worker = await createWorker({
    cachePath: path.join(__dirname, '../../cache'),
    logger: m => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Tesseract] ${m.status}: ${m.progress.toFixed(2) * 100}%`);
      }
    }
  });

  try {
    // Cargar idioma(s) y configurar
    await worker.loadLanguage(profile.lang);
    await worker.initialize(profile.lang);
    
    // Aplicar parámetros del perfil
    if (profile.parameters) {
      await worker.setParameters(profile.parameters);
    }

    // Reconocer texto en la imagen
    const { data } = await worker.recognize(imagePath);
    
    // Liberar recursos
    await worker.terminate();
    
    return {
      text: data.text,
      confidence: data.confidence,
      words: data.words || [],
      hocr: data.hocr,
      tsv: data.tsv
    };
  } catch (error) {
    if (worker) await worker.terminate();
    console.error('Error en OCR:', error);
    throw new Error(`Error procesando imagen: ${error.message}`);
  }
}

// Convertir PDF a imágenes y procesarlas
async function processPDF(pdfPath, profileName = 'general') {
  const profile = OCR_PROFILES[profileName] || OCR_PROFILES.general;
  const pdfOptions = profile.pdfOptions || {};
  
  try {
    // Directorio para archivos temporales
    const tempDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generar un ID único para esta operación
    const jobId = Date.now().toString();
    const outputPrefix = path.join(tempDir, `page-${jobId}`);
    
    // Opciones para pdftoppm
    const resolution = pdfOptions.resolution || 200;
    const grayscaleOption = pdfOptions.grayscale ? '-gray' : '';
    
    // Comando mejorado para convertir PDF a imágenes
    const command = `"${PDFTOPPM_PATH}" -png ${grayscaleOption} -r ${resolution} -aa yes -aaVector yes "${pdfPath}" "${outputPrefix}"`;
    
    try {
      console.log('Ejecutando comando:', command);
      execSync(command);
    } catch (error) {
      throw new Error(`Error convirtiendo PDF a imágenes: ${error.message}`);
    }
    
    // Encuentra todos los archivos generados
    const imageFiles = fs.readdirSync(tempDir)
      .filter(file => file.startsWith(`page-${jobId}`))
      .sort((a, b) => {
        const numA = parseInt(a.split('-').pop().split('.')[0]);
        const numB = parseInt(b.split('-').pop().split('.')[0]);
        return numA - numB;
      });
    
    if (imageFiles.length === 0) {
      throw new Error('No se pudieron generar imágenes del PDF');
    }
    
    // Determinar si usar procesamiento paralelo
    const useParallel = imageFiles.length > 2 && os.cpus().length > 1;
    let results = [];
    
    if (useParallel) {
      // Procesamiento paralelo para PDFs largos
      results = await processImagesParallel(imageFiles, tempDir, profileName);
    } else {
      // Procesamiento secuencial para PDFs cortos
      results = await processImagesSequential(imageFiles, tempDir, profileName);
    }
    
    return {
      type: 'pdf',
      pages: results,
      totalPages: results.length,
      averageConfidence: results.reduce((sum, page) => sum + page.confidence, 0) / results.length
    };
  } catch (error) {
    console.error('Error procesando PDF:', error);
    throw new Error(`Error procesando PDF: ${error.message}`);
  }
}

// Procesamiento secuencial de imágenes
async function processImagesSequential(imageFiles, tempDir, profileName) {
  const results = [];
  
  for (const imageFile of imageFiles) {
    const imagePath = path.join(tempDir, imageFile);
    const pageResult = await processImage(imagePath, profileName);
    
    // Obtener número de página del nombre del archivo
    const pageNum = parseInt(imageFile.split('-').pop().split('.')[0]);
    
    results.push({
      page: pageNum,
      ...pageResult
    });
    
    // Eliminar imagen temporal
    try {
      fs.unlinkSync(imagePath);
    } catch (err) {
      console.warn(`No se pudo eliminar la imagen temporal ${imagePath}:`, err.message);
    }
  }
  
  return results;
}

// Procesamiento paralelo de imágenes (para PDFs grandes)
async function processImagesParallel(imageFiles, tempDir, profileName) {
  const profile = OCR_PROFILES[profileName] || OCR_PROFILES.general;
  const scheduler = createScheduler();
  const numWorkers = Math.min(4, os.cpus().length - 1); // Usar hasta 4 workers o CPUs-1
  
  // Crear y configurar workers
  for (let i = 0; i < numWorkers; i++) {
    const worker = await createWorker({
      cachePath: path.join(__dirname, '../../cache')
    });
    await worker.loadLanguage(profile.lang);
    await worker.initialize(profile.lang);
    
    // Aplicar parámetros del perfil
    if (profile.parameters) {
      await worker.setParameters(profile.parameters);
    }
    
    scheduler.addWorker(worker);
  }
  
  try {
    // Crear un array de promesas para cada trabajo
    const recognitionPromises = imageFiles.map((imageFile, idx) => {
      const imagePath = path.join(tempDir, imageFile);
      const pageNum = parseInt(imageFile.split('-').pop().split('.')[0]);
      
      return scheduler.addJob('recognize', imagePath)
        .then(result => {
          // Eliminar imagen después de procesar
          try {
            fs.unlinkSync(imagePath);
          } catch (err) {
            console.warn(`No se pudo eliminar la imagen temporal ${imagePath}:`, err.message);
          }
          
          return {
            page: pageNum,
            text: result.data.text,
            confidence: result.data.confidence,
            words: result.data.words || []
          };
        });
    });
    
    // Ejecutar todos los trabajos en paralelo
    const results = await Promise.all(recognitionPromises);
    
    // Ordenar por número de página
    return results.sort((a, b) => a.page - b.page);
  } finally {
    // Liberar recursos
    await scheduler.terminate();
  }
}

// Función para detectar automáticamente el tipo de documento
async function detectDocumentType(imagePath) {
  // Implementar lógica para detectar el tipo de documento
  // Por ejemplo, buscando patrones específicos en el texto
  const worker = await createWorker();
  
  try {
    await worker.loadLanguage('spa');
    await worker.initialize('spa');
    
    const { data } = await worker.recognize(imagePath);
    const text = data.text.toLowerCase();
    
    await worker.terminate();
    
    // Detectar tipo de documento basado en palabras clave
    if (text.includes('factura') || text.includes('iva') || text.includes('total:')) {
      return 'invoice';
    } else if (/\d{5,}/.test(text)) { // Contiene números largos
      return 'numbers';
    } else if (/[a-z]{3,}\s+[a-z]{3,}/i.test(text)) { // Contiene palabras completas
      return 'document';
    }
    
    // Por defecto
    return 'general';
  } catch (error) {
    if (worker) await worker.terminate();
    console.error('Error detectando tipo de documento:', error);
    return 'general'; // Perfil por defecto en caso de error
  }
}

// Exportar funciones del módulo
module.exports = {
  checkTesseractInstallation,
  processImage,
  processPDF,
  detectDocumentType,
  OCR_PROFILES
};

// const { createWorker } = require('tesseract.js');
// const { execSync, exec } = require('child_process');
// const util = require('util');
// const fs = require('fs');
// const path = require('path');

// const execPromise = util.promisify(exec);

// // REEMPLAZA ESTAS RUTAS con las que encontraste
// const TESSERACT_PATH = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Tesseract-OCR\\tesseract.exe'; // CAMBIA ESTA RUTA
// const PDFTOPPM_PATH = 'C:\\Program Files\\Filespoppler-24.07.0-0\\poppler-24.07.0\\Library\\bin\\pdftoppm.exe';    // CAMBIA ESTA RUTA

// // Verificar instalación de Tesseract
// async function checkTesseractInstallation() {
//   try {
//     // Usar la ruta completa al ejecutable
//     const { stdout } = await execPromise(`"${TESSERACT_PATH}" --version`);
//     console.log('Tesseract instalado:', stdout.split('\n')[0]);
//     return true;
//   } catch (error) {
//     console.error('Error verificando Tesseract:', error.message);
//     return false;
//   }
// }

// // Procesar imagen con Tesseract
// async function processImage(imagePath) {
//   // Crear un worker de Tesseract
//   const worker = await createWorker();

//   try {
//     await worker.loadLanguage('spa');
//     await worker.initialize('');
    
//     // Configuración para OCR
//     await worker.setParameters({
//       tessedit_ocr_engine_mode: '3',
//       tessedit_pageseg_mode: '6'
//     });

//     const { data } = await worker.recognize(imagePath);
    
//     await worker.terminate();
    
//     return {
//       text: data.text,
//       confidence: data.confidence,
//       words: data.words || []
//     };
//   } catch (error) {
//     if (worker) await worker.terminate();
//     console.error('Error en OCR:', error);
//     throw new Error(`Error procesando imagen: ${error.message}`);
//   }
// }

// // Convertir PDF a imágenes y procesarlas
// async function processPDF(pdfPath) {
//   try {
//     // Directorio para archivos temporales
//     const tempDir = path.join(__dirname, '../../uploads/temp');
//     if (!fs.existsSync(tempDir)) {
//       fs.mkdirSync(tempDir, { recursive: true });
//     }

//     // Generar un ID único para esta operación
//     const jobId = Date.now().toString();
//     const outputPrefix = path.join(tempDir, `page-${jobId}`);
    
//     // Comando para convertir PDF a imágenes usando pdftoppm con ruta completa
//     const command = `"${PDFTOPPM_PATH}" -png "${pdfPath}" "${outputPrefix}"`;
    
//     try {
//       console.log('Ejecutando comando:', command);
//       execSync(command);
//     } catch (error) {
//       throw new Error(`Error convirtiendo PDF a imágenes: ${error.message}`);
//     }
    
//     // Encuentra todos los archivos generados
//     const imageFiles = fs.readdirSync(tempDir)
//       .filter(file => file.startsWith(`page-${jobId}`))
//       .sort((a, b) => {
//         const numA = parseInt(a.split('-').pop().split('.')[0]);
//         const numB = parseInt(b.split('-').pop().split('.')[0]);
//         return numA - numB;
//       });
    
//     if (imageFiles.length === 0) {
//       throw new Error('No se pudieron generar imágenes del PDF');
//     }
    
//     // Procesar cada imagen
//     const results = [];
//     for (const imageFile of imageFiles) {
//       const imagePath = path.join(tempDir, imageFile);
//       const pageResult = await processImage(imagePath);
      
//       // Obtener número de página del nombre del archivo
//       const pageNum = parseInt(imageFile.split('-').pop().split('.')[0]);
      
//       results.push({
//         page: pageNum,
//         ...pageResult
//       });
      
//       // Eliminar imagen temporal
//       try {
//         fs.unlinkSync(imagePath);
//       } catch (err) {
//         console.warn(`No se pudo eliminar la imagen temporal ${imagePath}:`, err.message);
//       }
//     }
    
//     return {
//       type: 'pdf',
//       pages: results,
//       totalPages: results.length,
//       averageConfidence: results.reduce((sum, page) => sum + page.confidence, 0) / results.length
//     };
//   } catch (error) {
//     console.error('Error procesando PDF:', error);
//     throw new Error(`Error procesando PDF: ${error.message}`);
//   }
// }

// module.exports = {
//   checkTesseractInstallation,
//   processImage,
//   processPDF
// };