import { createStyles } from 'antd-style';

export const useWorkbenchStyles = createStyles(({ css, token }) => ({
  workbench: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: ${token.marginMD}px;
  `,
  panel: css`
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr) 280px;
    gap: ${token.marginMD}px;
    align-items: start;

    @media (max-width: 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  queue: css`
    min-width: 0;
  `,
  workspace: css`
    min-width: 0;
  `,
  context: css`
    min-width: 0;
  `,
  selected: css`
    border-color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  scrollTable: css`
    overflow-x: auto;
  `,
  feedback: css`
    margin-bottom: ${token.marginMD}px;
  `,
}));
