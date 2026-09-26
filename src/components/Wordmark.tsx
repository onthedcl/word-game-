// Bubbly blue-and-yellow title in the style of the Schmexicon logo art.
const LETTERS = [...'SCHMEXICON'];

export function Wordmark() {
  return (
    <h1 aria-label="Schmexicon" className="flex text-[1.7rem] leading-none font-black tracking-tight sm:text-3xl">
      {LETTERS.map((ch, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block"
          style={{
            color: i % 2 ? '#f7c21a' : '#1f5fd6',
            WebkitTextStroke: '2px #fff',
            paintOrder: 'stroke fill',
            textShadow: '0 2px 0 #123a8c, 0 3px 4px rgb(0 0 0 / 0.25)',
            transform: `rotate(${i % 3 === 0 ? -3 : i % 3 === 1 ? 2 : 0}deg)`,
          }}
        >
          {ch}
        </span>
      ))}
    </h1>
  );
}
