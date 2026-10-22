import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StaticFallbackHero } from './StaticFallbackHero';

interface Props {
  children: ReactNode;
  fallbackProps?: {
    simulatorStatus?: string;
    failureProbability?: number;
    riskTier?: string;
    isSimulated?: boolean;
  };
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class SceneErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('3D Industrial Scene WebGL error caught:', error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <StaticFallbackHero
          {...this.props.fallbackProps}
          message="WebGL acceleration unavailable or context lost. Showing 2D telemetry schematic."
        />
      );
    }

    return this.props.children;
  }
}
