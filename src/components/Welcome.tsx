import { NameForm } from './Leaderboard';
import { isHomeScreenApp } from '../storage';

interface Props {
  onSave(name: string): Promise<void>;
  onClaim(name: string, code: string): Promise<void>;
  onSkip(): void;
  onRules(): void;
}

export function Welcome({ onSave, onClaim, onSkip, onRules }: Props) {
  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-xl">
        <img
          src={`${import.meta.env.BASE_URL}share.jpg`}
          alt="Lettertown: a hex board of letter tiles with a gold key tile in the middle"
          width={1024}
          height={1024}
          className="aspect-[1024/880] w-full scale-[1.06] object-cover object-[50%_10%]"
        />
      </div>
      <p className="mb-3">
        Find words by linking neighbouring tiles, using each tile only once per word. Every word must include the
        gold <b>key</b> tile. Drag and let go to submit. Boards are easiest on Monday and get harder each day, up to
        Sunday's toughest.
      </p>
      <p className="mb-4 text-sm text-muted">
        {isHomeScreenApp()
          ? 'Played before in your browser? Type the same name to keep your progress. New here? Pick a leaderboard name.'
          : 'What should we call you on the leaderboard?'}
      </p>
      <NameForm name="" cta="Play" onSave={onSave} onClaim={onClaim} />
      <div className="mt-4 flex justify-between text-sm text-muted">
        <button type="button" className="underline" onClick={onRules}>How to play</button>
        <button type="button" className="underline" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}
