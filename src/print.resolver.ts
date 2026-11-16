const PRINT_ROOT_CLASS = 'print-single';
const PRINT_PATH_CLASS = 'print-path';
const PRINT_TARGET_CLASS = 'print-target';

/**
 * Opens the browser print dialog (Save as PDF) for one element only. Everything outside the
 * element's ancestor path is hidden by the `print-single` rules in conversation.styles.css.
 * `title` becomes the suggested PDF file name; `onDone` runs once the dialog closes.
 */
export function printElement(target: HTMLElement, title: string, onDone?: () => void): void {
  const path: HTMLElement[] = [];
  for (let node = target.parentElement; node && node !== document.documentElement; node = node.parentElement) path.push(node);
  // Collapsed sections (provenance, monthly coverage) are part of the report.
  const closedDetails = [...target.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
  const previousTitle = document.title;

  const cleanup = () => {
    document.documentElement.classList.remove(PRINT_ROOT_CLASS);
    target.classList.remove(PRINT_TARGET_CLASS);
    path.forEach(node => node.classList.remove(PRINT_PATH_CLASS));
    closedDetails.forEach(details => { details.open = false; });
    document.title = previousTitle;
    onDone?.();
  };

  document.documentElement.classList.add(PRINT_ROOT_CLASS);
  target.classList.add(PRINT_TARGET_CLASS);
  path.forEach(node => node.classList.add(PRINT_PATH_CLASS));
  closedDetails.forEach(details => { details.open = true; });
  document.title = title;
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
