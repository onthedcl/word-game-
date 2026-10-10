const chip = 'inline-block rounded px-1.5 text-xs font-extrabold';
const link = 'underline';

/** Privacy policy, contact and credits for the word lists and code the game is built on. */
function About() {
  const base = import.meta.env.BASE_URL;
  return (
    <div className="mt-5 border-t border-line pt-3 text-sm text-muted">
      <p>
        <a className={link} href={`${base}privacy.html`} target="_blank" rel="noreferrer">Privacy policy</a>
        {' · '}
        <a className={link} href="https://github.com/onthedcl/word-game-/issues" target="_blank" rel="noreferrer">Contact &amp; feedback</a>
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer">Credits</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>Words from the <b>ENABLE</b> word list (public domain).</li>
          <li>
            Newer words from <a className={link} href="https://github.com/en-wl/wordlist" target="_blank" rel="noreferrer">SCOWL</a>,
            copyright 2000–2026 Kevin Atkinson (permissive license).
          </li>
          <li>
            Word commonness from <a className={link} href="https://github.com/hermitdave/FrequencyWords" target="_blank" rel="noreferrer">FrequencyWords</a>{' '}
            by Hermit Dave, built from OpenSubtitles (CC BY-SA 4.0). The game's word lists (<code>dict/</code>) are adapted from
            it and shared under the same license.
          </li>
          <li>
            Offensive-word filter from the{' '}
            <a className={link} href="https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words" target="_blank" rel="noreferrer">LDNOOBW</a>{' '}
            list (CC BY 4.0).
          </li>
          <li>Built with React (MIT) and other open-source libraries under the MIT license.</li>
        </ul>
      </details>
    </div>
  );
}

export function Rules() {
  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-xl">
        <img
          src={`${import.meta.env.BASE_URL}share.jpg`}
          alt="Lettertown: a hex board of letter tiles with a key tile in the middle"
          width={1024}
          height={1024}
          className="aspect-[1024/880] w-full scale-[1.06] object-cover object-[50%_10%]"
        />
      </div>
      <ul className="list-disc space-y-2 pl-5">
        <li>Make words of <b>4+ letters</b> by linking <b>neighbouring tiles</b>.</li>
        <li>You can use <b>each tile only once</b> in a word, but the board has repeat letters, so a letter can appear more than once.</li>
        <li>Every word must <b>include the dark key tile</b> in the middle, as its first, last or any letter.</li>
        <li>
          Each letter has a point value (shown on the tile; rarer letters score more). <span className={`${chip} bg-dl`}>DL</span> doubles a letter,{' '}
          <span className={`${chip} bg-tl text-white`}>TL</span> triples it, <span className={`${chip} bg-dw`}>DW</span>{' '}
          doubles the word (two DWs make ×4). +1 for every letter beyond four.
        </li>
        <li>A <b>pangram</b> is a word with <b>7 or more different letters</b>: +25, then the whole score doubles. Every board has one.</li>
        <li>
          Rarer words from the full word list are <b>bonus words</b> ★: they score points but don't count toward the
          board's word total.
        </li>
        <li>
          You'll often find the same word in more than one spot on the board. It only counts once, and it scores
          the spot you trace, so <b>pick the highest-scoring one</b> (look for premium tiles).
        </li>
        <li>
          Ranks: Tourist → Newcomer → Local → Wordsmith → Town Crier → Mayor, earned with points. The top rank,{' '}
          <b>Key to the City</b>, takes finding every word in the “words of” count. Bonus ★ words don't count
          toward it, and points alone top out at Mayor.
        </li>
      </ul>
      <h3 className="mt-4 mb-1 font-bold">Controls</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li><b>Drag</b> across tiles and <b>let go</b> to submit. Drag back to undo a step.</li>
        <li>Or <b>tap</b> tiles one by one, then tap the last tile again or press <b>Enter</b>.</li>
        <li>On a keyboard you can just type; the board shows a matching route.</li>
      </ul>
      <p className="mt-4 text-sm text-muted">
        <b>Daily</b>: a new board for everyone at midnight Eastern, progress saved. Boards get harder through the week, from an easy
        Monday to a tough Sunday. <b>Blitz</b>: a random board, three minutes, go.
      </p>
      <About />
    </div>
  );
}
