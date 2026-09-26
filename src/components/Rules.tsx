const chip = 'inline-block rounded px-1.5 text-xs font-extrabold';

export function Rules() {
  return (
    <div>
      <img
        src={`${import.meta.env.BASE_URL}lettertown.jpg`}
        alt="DPIYF Lettertown: letter tiles spelling DPIYF TOWNE on a wooden game board"
        width={1408}
        height={768}
        className="mb-4 aspect-[1408/768] w-full rounded-xl object-cover"
      />
      <ul className="list-disc space-y-2 pl-5">
        <li>Make words of <b>4+ letters</b> by linking <b>adjacent tiles</b>. Each tile once per word.</li>
        <li>Every word must pass through the gold <b>key tile</b> in the middle.</li>
        <li>
          Letters score their Scrabble value. <span className={`${chip} bg-dl`}>DL</span> doubles a letter,{' '}
          <span className={`${chip} bg-tl text-white`}>TL</span> triples it, <span className={`${chip} bg-dw`}>DW</span>{' '}
          doubles the word (two DWs make ×4). +1 for every letter beyond four.
        </li>
        <li>A <b>pangram</b> uses all 7 letters: +25, then the whole score doubles. Every board has one.</li>
        <li>Each word counts once, scored along its <b>best route</b> on the board.</li>
        <li>Ranks: Beginner → Solid → Nice → Great → Amazing → Genius → <b>Hexmaster</b> (every point).</li>
      </ul>
      <h3 className="mt-4 mb-1 font-bold">Controls</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li><b>Drag</b> across tiles and <b>let go</b> to submit. Drag back to undo a step.</li>
        <li>Or <b>tap</b> tiles one by one, then tap the last tile again or press <b>Enter</b>.</li>
        <li>On a keyboard you can just type; the board shows a matching route.</li>
      </ul>
      <p className="mt-4 text-sm text-muted">
        <b>Daily</b>: a new board at midnight, progress saved. <b>Blitz</b>: a random board, three minutes, go.
      </p>
    </div>
  );
}
