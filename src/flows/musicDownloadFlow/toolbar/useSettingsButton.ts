import { ToolbarButtonHook } from '../../../components/Toolbar';
import { useFocusContext } from '../../../contexts/FocusContext';

export const useSettingsButton: ToolbarButtonHook = () => {
  const { switchWindow } = useFocusContext();
  return {
    label: 'Settings',
    icon: '⛭',
    color: '#a0a0a0',
    enabled: true,
    onPress: () => switchWindow('settingsModal'),
  };
};
