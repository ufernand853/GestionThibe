export const STOCK_LIST_OPTIONS = [
  { value: 'general', label: 'Depósito General' },
  { value: 'overstockGeneral', label: 'Sobrestock General' },
  { value: 'overstockThibe', label: 'Sobrestock Thibe' },
  { value: 'overstockArenal', label: 'Sobrestock Arenal' },
  { value: 'customer', label: 'Cliente reservado' }
];

const STOCK_LIST_LABELS = STOCK_LIST_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

export function formatStockListLabel(value) {
  if (!value) {
    return '';
  }
  return STOCK_LIST_LABELS[value] || value;
}
