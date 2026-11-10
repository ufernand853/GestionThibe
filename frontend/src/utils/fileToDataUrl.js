export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('El archivo no pudo convertirse a una URL base64.'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('No se pudo leer el archivo.'));
    };
    reader.readAsDataURL(file);
  });
}
