import type { Locale } from '@powerbia/contracts';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'powerbia.locale';

export const resources = {
  es: {
    translation: {
      appName: 'Power BIA',
      nav: { chat: 'Consultas', dashboards: 'Vistas' },
      auth: {
        signIn: 'Iniciar sesión',
        signUp: 'Crear cuenta',
        email: 'Correo',
        password: 'Contraseña',
        displayName: 'Nombre',
        noAccount: '¿No tienes cuenta?',
        haveAccount: '¿Ya tienes cuenta?',
        signOut: 'Salir',
        passwordHint: 'Mínimo 12 caracteres',
      },
      chat: {
        newQuery: 'Nueva consulta',
        placeholder: 'Pregunta sobre tus datos…',
        emptyTitle: 'Consulta en lenguaje natural',
        emptyBody:
          'Pregunta lo que quieras sobre el modelo. Obtendrás datos reales y visualizaciones automáticas.',
        hint: 'ENTER enviar · SHIFT+ENTER nueva línea',
        noConversations: 'Sin conversaciones',
        thinking: 'Pensando…',
        showDax: 'Ver DAX',
        hideDax: 'Ocultar DAX',
        pinToDashboard: 'Fijar a una vista',
        delete: 'Eliminar',
        send: 'Enviar',
        confirmDeleteTitle: '¿Eliminar esta consulta?',
        confirmDeleteBody:
          'Se eliminará «{{title}}» y todos sus mensajes. Esta acción no se puede deshacer.',
        starters: [
          '¿Cuáles fueron las ventas totales en 2021?',
          'Muéstrame la evolución de ventas de 2012 a 2021',
          'Top 10 categorías por ventas en 2021',
        ],
      },
      dashboards: {
        title: 'Vistas',
        create: 'Crear vista',
        namePlaceholder: 'Nombre de la vista…',
        empty: 'Esta vista está vacía. Fija un gráfico desde el chat o pregunta aquí abajo.',
        noDashboards: 'Aún no tienes vistas.',
        askPlaceholder: 'Añade un gráfico preguntando…',
        filters: 'Filtros',
        clearFilter: 'Limpiar',
        search: 'Buscar…',
        refresh: 'Actualizar',
        edit: 'Editar consulta',
        remove: 'Eliminar',
        pin: 'Anclar',
        unpin: 'Desanclar',
        run: 'Ejecutar',
        cancel: 'Cancelar',
        export: 'Exportar PDF',
        selectedOf: '{{selected}} de {{total}} seleccionados',
        valueCount: '{{count}} valores',
        confirmDeleteTitle: '¿Eliminar esta vista?',
        confirmDeleteBody:
          'Se eliminará «{{name}}» y todos sus gráficos. Esta acción no se puede deshacer.',
      },
      table: {
        page: 'Página {{page}} de {{pages}}',
        noRows: 'Sin resultados',
        previous: 'Página anterior',
        next: 'Página siguiente',
      },
      common: {
        retry: 'Reintentar',
        loading: 'Cargando…',
        error: 'Algo ha ido mal',
        lightMode: 'Modo claro',
        darkMode: 'Modo oscuro',
        cancel: 'Cancelar',
        delete: 'Eliminar',
      },
    },
  },
  en: {
    translation: {
      appName: 'Power BIA',
      nav: { chat: 'Queries', dashboards: 'Dashboards' },
      auth: {
        signIn: 'Sign in',
        signUp: 'Create account',
        email: 'Email',
        password: 'Password',
        displayName: 'Name',
        noAccount: "Don't have an account?",
        haveAccount: 'Already have an account?',
        signOut: 'Sign out',
        passwordHint: 'At least 12 characters',
      },
      chat: {
        newQuery: 'New query',
        placeholder: 'Ask about your data…',
        emptyTitle: 'Natural language queries',
        emptyBody:
          'Ask anything about the model. You will get real data and automatic visualizations.',
        hint: 'ENTER to send · SHIFT+ENTER for a new line',
        noConversations: 'No conversations',
        thinking: 'Thinking…',
        showDax: 'Show DAX',
        hideDax: 'Hide DAX',
        pinToDashboard: 'Pin to a dashboard',
        delete: 'Delete',
        send: 'Send',
        confirmDeleteTitle: 'Delete this query?',
        confirmDeleteBody:
          '“{{title}}” and all of its messages will be deleted. This cannot be undone.',
        starters: [
          'What were total sales in 2021?',
          'Show me the sales trend from 2012 to 2021',
          'Top 10 categories by sales in 2021',
        ],
      },
      dashboards: {
        title: 'Dashboards',
        create: 'Create dashboard',
        namePlaceholder: 'Dashboard name…',
        empty: 'This dashboard is empty. Pin a chart from chat, or ask a question below.',
        noDashboards: "You don't have any dashboards yet.",
        askPlaceholder: 'Add a chart by asking…',
        filters: 'Filters',
        clearFilter: 'Clear',
        search: 'Search…',
        refresh: 'Refresh',
        edit: 'Edit query',
        remove: 'Remove',
        pin: 'Lock',
        unpin: 'Unlock',
        run: 'Run',
        cancel: 'Cancel',
        export: 'Export PDF',
        selectedOf: '{{selected}} of {{total}} selected',
        valueCount: '{{count}} values',
        confirmDeleteTitle: 'Delete this dashboard?',
        confirmDeleteBody:
          '“{{name}}” and all of its charts will be deleted. This cannot be undone.',
      },
      table: {
        page: 'Page {{page}} of {{pages}}',
        noRows: 'No results',
        previous: 'Previous page',
        next: 'Next page',
      },
      common: {
        retry: 'Retry',
        loading: 'Loading…',
        error: 'Something went wrong',
        lightMode: 'Light mode',
        darkMode: 'Dark mode',
        cancel: 'Cancel',
        delete: 'Delete',
      },
    },
  },
} as const;

export function storedLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);

  return saved === 'en' || saved === 'es' ? saved : 'es';
}

export function setLocale(locale: Locale) {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}

void i18next.use(initReactI18next).init({
  resources,
  lng: storedLocale(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export default i18next;
