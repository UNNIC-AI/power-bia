import type { TFunction } from 'i18next';
import { ApiError } from './api.ts';

/**
 * `ApiError.message` is the API's own text, which is fine everywhere else but
 * useless on an auth form: a wrong password and an unreachable API both used to
 * read as "Request failed (502)", because the dev proxy answers with no JSON
 * body. Map the statuses the auth and user routes actually return and treat the
 * rest as the server being down.
 */
export function authErrorMessage(error: Error, t: TFunction): string {
  if (!(error instanceof ApiError)) return t('auth.errors.unreachable');

  switch (error.status) {
    case 400:
    case 422:
      return t('auth.errors.invalidInput');
    case 401:
      return t('auth.errors.invalidCredentials');
    case 403:
      return t('auth.errors.forbidden');
    case 409:
      return t('auth.errors.conflict');
    default:
      return error.status >= 500 ? t('auth.errors.unreachable') : error.message;
  }
}
