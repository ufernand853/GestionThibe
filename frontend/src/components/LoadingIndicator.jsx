export default function LoadingIndicator({ message = 'Cargando información...' }) {
  return <div className="page-loading">{message}</div>;
}
