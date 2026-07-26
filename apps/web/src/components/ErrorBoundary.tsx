import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary, so switching view clears a stale error. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken view from blanking the whole application.
 *
 * Without this, a single unexpected shape in stored data (a field added after a
 * record was written, an older API that lacks an endpoint) throws during render
 * and React unmounts everything, which reads to a user as "the tab does not
 * open" with nothing to act on. Here it becomes a message naming the failure.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('View failed to render', error, info.componentStack);
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-[15px] font-medium text-stone-900">This view could not be shown</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">
          Something in the data for this view was not what the page expected. The rest of the app still works.
        </p>
        <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-left font-mono text-[11.5px] text-stone-600">
          {error.message}
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Try again
        </button>
      </div>
    );
  }
}
