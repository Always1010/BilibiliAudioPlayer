export const ACTION_LAUNCH_MODE = Object.freeze({
  sidePanel: "sidepanel",
  page: "page"
});

export function normalizeActionLaunchMode(value) {
  return value === ACTION_LAUNCH_MODE.page ? ACTION_LAUNCH_MODE.page : ACTION_LAUNCH_MODE.sidePanel;
}

export function actionLaunchConfiguration(value) {
  const mode = normalizeActionLaunchMode(value);
  const opensSidePanel = mode === ACTION_LAUNCH_MODE.sidePanel;
  return {
    mode,
    opensSidePanel,
    title: opensSidePanel ? "打开哔哩音频侧边栏" : "打开哔哩音频完整页面"
  };
}
