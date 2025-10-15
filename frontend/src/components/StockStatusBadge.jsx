import { STOCK_STATUS_LABELS, stockStatusClassName } from '../utils/stockStatus.js';

export default function StockStatusBadge({ status }) {
  if (!status) {
    return null;
  }
  const label = status.label || STOCK_STATUS_LABELS[status.code] || status.code;
  const title = status.detail || label;
  return (
    <span className={stockStatusClassName(status.code)} title={title}>
      {label}
    </span>
  );
}

