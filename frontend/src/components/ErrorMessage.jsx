export default function ErrorMessage({ error }) {
  if (!error) {
    return null;
  }
  const message = typeof error === 'string' ? error : error.message || 'Ocurrió un error inesperado.';
  return <div className="error-message">{message}</div>;
}
