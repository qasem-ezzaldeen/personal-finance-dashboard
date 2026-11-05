import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-60 flex-col items-center justify-center p-6 text-center">
          <h2 className="text-lg font-semibold text-ink">{this.props.fallbackTitle ?? "Something went wrong"}</h2>
          <p className="mt-1 text-sm text-ink-soft">{this.state.error?.message ?? "An unexpected error occurred."}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
