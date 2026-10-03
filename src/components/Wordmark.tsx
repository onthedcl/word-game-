// Bubbly mint-on-plum title in the Lettertown colors.
const style: React.CSSProperties = {
  color: '#8fe8bd',
  WebkitTextStroke: '0.17em #4b2f86',
  paintOrder: 'stroke fill',
  filter: 'drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1px #fff) drop-shadow(0 2px 2px rgb(0 0 0 / 0.3))',
};

export function Wordmark() {
  return (
    <h1 aria-label="DPIYF Lettertown" className="flex flex-col leading-[0.95] font-black tracking-tight" style={style}>
      <span aria-hidden className="text-base max-[370px]:text-sm sm:text-lg">DPIYF</span>
      <span aria-hidden className="text-[1.7rem] max-[370px]:text-[1.35rem] sm:text-3xl">Lettertown</span>
    </h1>
  );
}
