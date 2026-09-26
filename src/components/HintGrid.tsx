import type { HintGrid as Grid } from '../engine/hints';

export function HintGrid({ grid }: { grid: Grid }) {
  if (!grid.total) return <p className="text-muted">Nothing left to find. Nice work!</p>;
  const cell = 'px-2 py-1 text-center tabular-nums';
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Words still to find, by first letter and length. {grid.total} left
        {grid.pangramsLeft ? `, including ${grid.pangramsLeft} pangram${grid.pangramsLeft > 1 ? 's' : ''}` : ''}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className={cell} />
              {grid.lengths.map((n) => <th key={n} className={cell}>{n}</th>)}
              <th className={cell}>Σ</th>
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
              <th className={cell}>Σ</th>
              {grid.lengths.map((n) => <td key={n} className={cell}>{grid.colTotals[n] || '–'}</td>)}
              <td className={cell}>{grid.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
