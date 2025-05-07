const fs = require('fs');
const path = require('path');

/**
 * Crea un directorio temporal
 */
function createTempDirectory(dirName) {
  const dirPath = path.join(__dirname, '../../uploads', dirName);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Elimina un archivo
 */
function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error(`Error eliminando archivo ${filePath}:`, error);
      return false;
    }
  }
  return false;
}

module.exports = {
  createTempDirectory,
  removeFile
};