// Bubbly yellow-on-blue title in the style of the DPIYF Lettertown logo art.
const style: React.CSSProperties = {
  color: '#f7c21a',
  WebkitTextStroke: '0.17em #1f5fd6',
  paintOrder: 'stroke fill',
  filter: 'drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1px #fff) drop-shadow(0 2px 2px rgb(0 0 0 / 0.3))',
};

export function Wordmark() {
  return (
    <h1 aria-label="DPIYF Lettertown" className="flex flex-col leading-[0.95] font-black tracking-tight" style={style}>
      <span aria-hidden className="text-base sm:text-lg">DPIYF</span>
      <span aria-hidden className="text-[1.7rem] sm:text-3xl">Lettertown</span>
    </h1>
  );
}
