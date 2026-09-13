import type { DashboardWidgetConfig } from '@/types';

/** Props every widget component receives — the instance's own config. */
export interface WidgetComponentProps {
  config: DashboardWidgetConfig;
}
