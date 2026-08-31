/**
 * Decorates a table block: renders the authored block rows as a semantic
 * <table>. The first multi-cell row becomes the column header (<th>), unless
 * the `plain` variant is set (key/value tables with no header — first column
 * is styled as a row header instead). A leading single-cell row in a
 * multi-column table is treated as a full-width caption bar.
 * @param {Element} block the table block element
 */
export default function decorate(block) {
  const plain = block.classList.contains('plain');
  const rows = [...block.children];
  const maxCols = rows.reduce((m, r) => Math.max(m, r.children.length), 0);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  let headerDone = plain;
  rows.forEach((row) => {
    const cells = [...row.children];
    const tr = document.createElement('tr');

    if (!headerDone && cells.length === 1 && maxCols > 1) {
      const th = document.createElement('th');
      th.className = 'table-caption';
      th.setAttribute('colspan', maxCols);
      th.innerHTML = cells[0].innerHTML;
      tr.append(th);
      thead.append(tr);
      return;
    }

    if (!headerDone) {
      cells.forEach((cell) => {
        const th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.innerHTML = cell.innerHTML;
        tr.append(th);
      });
      thead.append(tr);
      headerDone = true;
      return;
    }

    cells.forEach((cell, ci) => {
      const td = document.createElement('td');
      td.innerHTML = cell.innerHTML;
      if (plain && ci === 0) td.className = 'table-rowhead';
      tr.append(td);
    });
    tbody.append(tr);
  });

  if (thead.children.length) table.append(thead);
  table.append(tbody);
  block.textContent = '';
  block.append(table);
}
