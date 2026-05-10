import { SettingsStore } from '../../settings/settingsStore';

export class FlowSettings<TSettings extends Record<string, unknown>> {
    constructor(
        private readonly flowId: string,
        private readonly getDefaults: () => TSettings,
    ) { }

    get(): TSettings {
        return SettingsStore.getInstance().getFlowSettings(this.flowId, this.getDefaults());
    }

    save(settings: Record<string, unknown>): void {
        SettingsStore.getInstance().writeFlowSettings(this.flowId, settings);
    }
}
