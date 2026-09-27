import type { HintGrid as Grid } from '../engine/hints';

export function HintGrid({ grid }: { grid: Grid }) {
  if (!grid.total) return <p className="text-muted">Nothing left to find. Nice work!</p>;
  const cell = 'px-2 py-1 text-center tabular-nums';
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        {grid.total} word{grid.total > 1 ? 's' : ''} still to find
        {grid.pangramsLeft ? `, including ${grid.pangramsLeft} pangram${grid.pangramsLeft > 1 ? 's' : ''}` : ''}.
        Each row is the first letter, each column the word length: a 2 in row <b>S</b>, column <b>5</b> means two
        5-letter words starting with S are left.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className={`${cell} text-left text-xs font-normal`}>Starts with</th>
              {grid.lengths.map((n) => <th key={n} className={cell}>{n}</th>)}
              <th className={cell}>Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.letters.map((l) => (
              <tr key={l} className="border-b border-line">
                <th className={`${cell} font-extrabold uppercase`}>{l}</th>
                {grid.lengths.map((n) => (
                  <td key={n} className={`${cell} ${grid.cells[l][n] ? '' : 'text-muted/50'}`}>{grid.cells[l][n] ?? '–'}</td>
                ))}
                <td className={`${cell} font-bold`}>{grid.rowTotals[l] || '–'}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <th className={`${cell} text-left`}>Total</th>
              {grid.lengths.map((n) => <td key={n} className={cell}>{grid.colTotals[n] || '–'}</td>)}
              <td className={cell}>{grid.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
