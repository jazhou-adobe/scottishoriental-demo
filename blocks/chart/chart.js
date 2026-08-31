const HIGHSTOCK = 'https://code.highcharts.com/stock/highstock.js';
let hcPromise;

/** Loads Highstock once and resolves when window.Highcharts is ready. */
function loadHighcharts() {
  if (window.Highcharts) return Promise.resolve();
  if (!hcPromise) {
    hcPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HIGHSTOCK;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return hcPromise;
}

const PALETTE = ['#392874', '#00a3ad', '#e87722', '#5a3fa0'];

/**
 * Decorates a chart block: renders a Highcharts stock line chart from the
 * self-hosted soscot charting.json. Authored rows (key/value):
 *   src      — data file (default ./charting.json, resolved next to this block)
 *   dataset  — index into json['soscot-chart'] (1 = NAV/price, 2 = discount)
 *   title    — chart title
 *   suffix   — value suffix for tooltip/axis (e.g. p or %)
 * @param {Element} block the chart block element
 */
export default async function decorate(block) {
  const cfg = {};
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    const key = cells[0]?.textContent.trim().toLowerCase();
    const value = cells[1]?.textContent.trim();
    if (key) cfg[key] = value;
  });

  const dataset = parseInt(cfg.dataset || '1', 10);
  const suffix = cfg.suffix || '';
  const src = cfg.src || './charting.json';

  block.textContent = '';
  const holder = document.createElement('div');
  holder.className = 'chart-holder';
  block.append(holder);

  try {
    const dataUrl = new URL(src, import.meta.url).href;
    const [json] = await Promise.all([
      fetch(dataUrl).then((r) => r.json()),
      loadHighcharts(),
    ]);
    const node = json['soscot-chart'][dataset];
    const series = node.data_set.map((s, i) => ({
      name: s.name,
      data: s.data,
      color: PALETTE[i % PALETTE.length],
      lineWidth: 2,
    }));

    window.Highcharts.stockChart(holder, {
      chart: { height: 440, backgroundColor: '#ffffff', style: { fontFamily: 'inherit' } },
      title: { text: cfg.title || node.title, style: { color: '#1d1d1d', fontSize: '18px' } },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { color: '#333' } },
      rangeSelector: {
        selected: 5,
        buttonTheme: { fill: '#f0eef6', style: { color: '#392874' }, states: { select: { fill: '#392874', style: { color: '#fff' } } } },
        inputStyle: { color: '#333' },
        labelStyle: { color: '#333' },
      },
      navigator: { enabled: true },
      scrollbar: { enabled: false },
      tooltip: {
        valueSuffix: suffix, valueDecimals: 2, split: false, shared: true,
      },
      xAxis: { labels: { style: { color: '#333' } }, lineColor: '#cccccc', tickColor: '#cccccc' },
      yAxis: {
        opposite: false,
        gridLineColor: '#eeeeee',
        labels: { format: `{value}${suffix}`, style: { color: '#333' } },
      },
      series,
    });
  } catch (e) {
    holder.innerHTML = '<p>Chart data is currently unavailable.</p>';
  }
}
