const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Función para buscar recursivamente tesseract.exe
function findTesseract(startDir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) return null;
  
  try {
    const files = fs.readdirSync(startDir);
    
    for (const file of files) {
      const filePath = path.join(startDir, file);
      
      try {
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
          const result = findTesseract(filePath, maxDepth, currentDepth + 1);
          if (result) return result;
        } else if (file.toLowerCase() === 'tesseract.exe') {
          return filePath;
        }
      } catch (error) {
        // Ignorar errores de acceso
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
  }
  
  return null;
}

// Posibles ubicaciones comunes de instalación
const commonLocations = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\Tesseract-OCR'
];

console.log('Buscando tesseract.exe en ubicaciones comunes...');

let tesseractPath = null;

for (const location of commonLocations) {
  console.log(`Buscando en ${location}...`);
  tesseractPath = findTesseract(location);
  if (tesseractPath) {
    console.log(`✅ ¡Encontrado! Tesseract está en: ${tesseractPath}`);
    break;
  }
}

if (!tesseractPath) {
  console.log('❌ No se pudo encontrar tesseract.exe automáticamente');
  console.log('Por favor, busca manualmente dónde está instalado Tesseract en tu sistema');
}

// Intentar ejecutar con la ruta completa si se encontró
if (tesseractPath) {
  try {
    const version = execSync(`"${tesseractPath}" --version`).toString();
    console.log('Versión detectada:');
    console.log(version);
  } catch (error) {
    console.error('Error ejecutando tesseract aunque se encontró la ruta:', error.message);
  }
}

// Buscar pdftoppm también
console.log('\nBuscando pdftoppm.exe en ubicaciones comunes...');

let pdftoppmPath = null;

for (const location of commonLocations) {
  pdftoppmPath = findTesseract(location, 4).replace('tesseract.exe', 'pdftoppm.exe');
  if (fs.existsSync(pdftoppmPath)) {
    console.log(`✅ ¡Encontrado! pdftoppm está en: ${pdftoppmPath}`);
    break;
  }
}

if (!pdftoppmPath || !fs.existsSync(pdftoppmPath)) {
  console.log('❌ No se pudo encontrar pdftoppm.exe automáticamente');
}