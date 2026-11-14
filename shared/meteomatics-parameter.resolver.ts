import { METEOMATICS_PARAMETER_CATALOG } from './meteomatics-catalog.constant';

/** Catalog placeholders describe parameter families, not literal request codes. */
export function isMeteomaticsParameter(parameter: string): boolean {
  return METEOMATICS_PARAMETER_CATALOG.some(item => {
    if (item.parameter === parameter) return true;
    const escaped = item.parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const template = escaped.replace(/0{2,3}(?=m|cm|hPa|h|d)/g, '[0-9]{1,5}');
    return template !== escaped && new RegExp(`^${template}$`).test(parameter);
  });
}
