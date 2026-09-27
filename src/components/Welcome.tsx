import { NameForm } from './Leaderboard';
import { isHomeScreenApp } from '../storage';

interface Props {
  onSave(name: string): Promise<void>;
  onClaim(name: string): Promise<void>;
  onSkip(): void;
  onRules(): void;
}

export function Welcome({ onSave, onClaim, onSkip, onRules }: Props) {
  return (
    <div>
      <img
        src={`${import.meta.env.BASE_URL}lettertown.jpg`}
        alt="DPIYF Lettertown: letter tiles on a wooden game board"
        width={1408}
        height={768}
        className="mb-4 aspect-[1408/768] w-full rounded-xl object-cover"
      />
      <p className="mb-3">
        Find words by linking neighbouring tiles, using each tile only once per word. Every word must include the
        gold <b>key</b> tile. Drag and let go to submit.
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
