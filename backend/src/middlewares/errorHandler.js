const { HttpError } = require('../utils/errors');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
  let status = 500;
  let message = 'Error interno del servidor';
  let details;

  if (err instanceof HttpError) {
    status = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'La solicitud es demasiado grande. Puedes subir hasta 10 imágenes de 5 MB cada una.';
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = err.message;
    details = err.errors;
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Identificador inválido';
  }

  if (status >= 500) {
    console.error(err);
  }

  const payload = { message };
  if (details) {
    payload.details = details;
  }

  res.status(status).json(payload);
}

module.exports = errorHandler;
