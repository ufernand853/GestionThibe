const WIDTH = 140;
const HEIGHT = 48;
const PADDING = 6;

function buildPoints(data) {
  const sanitized = data.filter(value => Number.isFinite(value));
  if (sanitized.length === 0) {
    return [];
  }
  if (sanitized.length === 1) {
    sanitized.push(sanitized[0]);
  }
  const min = Math.min(...sanitized);
  const max = Math.max(...sanitized);
  const range = max - min || 1;
  const step = (WIDTH - PADDING * 2) / (sanitized.length - 1 || 1);
  return sanitized.map((value, index) => {
    const x = PADDING + step * index;
    const normalizedY = (value - min) / range;
    const y = HEIGHT - PADDING - normalizedY * (HEIGHT - PADDING * 2);
    return `${x},${y}`;
  });
}

export default function Sparkline({ data, color = '#2563eb', strokeWidth = 2, ariaLabel }) {
  const points = buildPoints(Array.isArray(data) ? data : []);
  if (points.length === 0) {
    return (
      <svg
        className="sparkline"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel || 'Sin datos suficientes para graficar'}
      >
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const path = points.join(' ');

  return (
    <svg className="sparkline" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel || 'Tendencia'}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={path}
      />
    </svg>
  );
}
