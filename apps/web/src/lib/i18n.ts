import type { Locale } from '@powerbia/contracts';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'powerbia.locale';

export const resources = {
  es: {
    translation: {
      appName: 'Power BIA',
      nav: {
        chat: 'Chat',
        dashboards: 'Vistas',
        showSidebar: 'Mostrar el panel',
        hideSidebar: 'Ocultar el panel',
      },
      prompt: { placeholder: 'Pregunta sobre tus datos…' },
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
        showPassword: 'Mostrar la contraseña',
        firstRunHelp:
          'Esta instancia todavía no tiene cuentas. La primera que se cree será la de administrador.',
        createAdmin: 'Crear la cuenta de administrador',
        noSignUp: 'Las cuentas las crea un administrador. Pídele acceso si no tienes una.',
        hidePassword: 'Ocultar la contraseña',
        errors: {
          invalidCredentials: 'Correo o contraseña incorrectos',
          conflict: 'Ese correo ya tiene una cuenta',
          forbidden: 'No tienes permiso para hacer esto',
          invalidInput: 'Revisa los datos introducidos',
          unreachable: 'No se puede conectar con el servidor. Inténtalo de nuevo.',
        },
      },
      chat: {
        newQuery: 'Nuevo chat',
        emptyTitle: 'Consulta en lenguaje natural',
        emptyBody:
          'Pregunta lo que quieras sobre el modelo. Obtendrás datos reales y visualizaciones automáticas.',
        noConversations: 'Sin conversaciones',
        thinking: 'Pensando…',
        showDax: 'Ver DAX',
        hideDax: 'Ocultar DAX',
        pinToDashboard: 'Fijar a una vista',
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
        create: 'Nueva vista',
        defaultName: 'Vista sin título',
        empty: 'Esta vista está vacía. Fija un gráfico desde el chat o pregunta aquí abajo.',
        noDashboards: 'Aún no tienes vistas.',
        add: 'Añadir gráfico',
        filters: 'Filtros',
        clearFilter: 'Limpiar',
        search: 'Buscar…',
        refresh: 'Actualizar',
        edit: 'Editar consulta',
        dax: 'DAX generado',
        noDax: 'Este gráfico aún no tiene DAX guardado. Ejecuta la consulta para generarlo.',
        daxNotApplicable: 'Esta tarjeta no ejecuta DAX: sus valores salen del catálogo del modelo.',
        remove: 'Eliminar',
        pin: 'Anclar',
        unpin: 'Desanclar',
        run: 'Ejecutar',
        cancel: 'Cancelar',
        export: 'Exportar PDF',
        selectedOf: '{{selected}} de {{total}} seleccionados',
        valueCount: '{{count}} valores',
        confirmRemoveTitle: '¿Quitar este gráfico?',
        confirmRemoveBody:
          'Se quitará «{{title}}» de la vista. La conversación que lo generó no se toca.',
        confirmDeleteTitle: '¿Eliminar esta vista?',
        confirmDeleteBody:
          'Se eliminará «{{name}}» y todos sus gráficos. Esta acción no se puede deshacer.',
      },
      table: {
        page: 'Página {{page}} de {{pages}}',
        noRows: 'Sin resultados',
        yes: 'Sí',
        no: 'No',
        previous: 'Página anterior',
        next: 'Página siguiente',
      },
      settings: {
        title: 'Ajustes del modelo',
        counts: '{{tables}} tablas · {{measures}} medidas',
        lastSync: 'Última sincronización: {{day}} a las {{time}}',
        neverSynced: 'Nunca sincronizado con Power BI',
        source: 'Modelo de Power BI',
        sourceHelp:
          'Se configura con las variables PBI_* del servidor. Para apuntar a otro modelo, cámbialas y reinicia la aplicación.',
        extraContext: 'Contexto adicional',
        extraContextHelp:
          'Lo redacta el asistente al leer el modelo, y se añade a su prompt en todas las etapas. Corrígelo o amplíalo: nombres de tabla poco claros, vocabulario de negocio o avisos sobre columnas concretas.',
        extraContextPlaceholder:
          'Ej.: TBL_VTA_CAB es la cabecera de ventas. «Facturación» = precio de venta × unidades.',
        contextGeneratedAt: 'Redactado por el asistente el {{day}} a las {{time}}',
        contextEdited: 'Editado a mano',
        reprocess: 'Reprocesar contexto',
        reprocessing: 'Reprocesando…',
        reprocessHelp:
          'El asistente vuelve a leer el modelo y reescribe el texto de arriba. Úsalo cuando el modelo haya cambiado.',
        reprocessConfirm:
          'El asistente reescribirá el contexto adicional a partir del modelo. Se perderá el texto actual, incluidas tus ediciones.',
        sync: 'Sincronizar modelo',
        syncDone: 'Sincronizado en {{seconds}} s',
        syncCounts:
          '{{tables}} tablas · {{columns}} columnas · {{measures}} medidas · {{removed}} eliminadas',
        syncWroteContext: 'También se ha redactado el contexto del modelo.',
        noDataset: 'No hay ningún modelo de datos conectado.',
        save: 'Guardar',
      },
      account: {
        title: 'Mi cuenta',
        currentPassword: 'Contraseña actual',
        newPassword: 'Contraseña nueva',
        repeatPassword: 'Repite la contraseña',
        mismatch: 'Las dos contraseñas no coinciden',
        changed: 'Contraseña actualizada. Se han cerrado las demás sesiones.',
        save: 'Cambiar la contraseña',
      },
      users: {
        title: 'Usuarios',
        help: 'Las cuentas solo las crea un administrador. Cada usuario puede cambiar su propia contraseña.',
        admin: 'Administrador',
        add: 'Añadir usuario',
        addHint: 'Mínimo 12 caracteres. Tendrás que comunicársela tú.',
        create: 'Crear la cuenta',
        makeAdmin: 'Darle permisos de administrador',
        remove: 'Eliminar el usuario',
        cannotRemoveSelf: 'No puedes eliminar tu propia cuenta',
        removeTitle: '¿Eliminar el usuario?',
        removeBody:
          'Se eliminará {{email}} junto con sus conversaciones y sus vistas. No se puede deshacer.',
        resetPassword: 'Restablecer',
        newPassword: 'Contraseña nueva',
        resetHint: 'Mínimo 12 caracteres. Se cerrarán todas las sesiones de ese usuario.',
        setPassword: 'Guardar la contraseña',
        resetDone: 'Contraseña restablecida.',
      },
      common: {
        retry: 'Reintentar',
        close: 'Cerrar',
        loading: 'Cargando…',
        error: 'Algo ha ido mal',
        lightMode: 'Modo claro',
        darkMode: 'Modo oscuro',
        cancel: 'Cancelar',
        delete: 'Eliminar',
        rename: 'Renombrar',
        actions: 'Acciones',
        regenerateTitle: 'Regenerar título',
        updatedOn: 'Actualizado el {{day}}',
        createdOn: 'Creado el {{day}}',
      },
    },
  },
  en: {
    translation: {
      appName: 'Power BIA',
      nav: {
        chat: 'Chat',
        dashboards: 'Views',
        showSidebar: 'Show the sidebar',
        hideSidebar: 'Hide the sidebar',
      },
      prompt: { placeholder: 'Ask about your data…' },
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
        showPassword: 'Show the password',
        firstRunHelp: 'This instance has no accounts yet. The first one created becomes the admin.',
        createAdmin: 'Create the admin account',
        noSignUp: 'Accounts are created by an admin. Ask for access if you do not have one.',
        hidePassword: 'Hide the password',
        errors: {
          invalidCredentials: 'Wrong email or password',
          conflict: 'That email already has an account',
          forbidden: 'You are not allowed to do that',
          invalidInput: 'Check the details you entered',
          unreachable: 'Cannot reach the server. Please try again.',
        },
      },
      chat: {
        newQuery: 'New chat',
        emptyTitle: 'Natural language queries',
        emptyBody:
          'Ask anything about the model. You will get real data and automatic visualizations.',
        noConversations: 'No conversations',
        thinking: 'Thinking…',
        showDax: 'Show DAX',
        hideDax: 'Hide DAX',
        pinToDashboard: 'Pin to a view',
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
        title: 'Views',
        create: 'New view',
        defaultName: 'Untitled view',
        empty: 'This view is empty. Pin a chart from chat, or ask a question below.',
        noDashboards: "You don't have any views yet.",
        add: 'Add chart',
        filters: 'Filters',
        clearFilter: 'Clear',
        search: 'Search…',
        refresh: 'Refresh',
        edit: 'Edit query',
        dax: 'Generated DAX',
        noDax: 'This widget has no stored DAX yet. Run the question to generate it.',
        daxNotApplicable: "This card doesn't run DAX — its values come from the model catalogue.",
        remove: 'Remove',
        pin: 'Lock',
        unpin: 'Unlock',
        run: 'Run',
        cancel: 'Cancel',
        export: 'Export PDF',
        selectedOf: '{{selected}} of {{total}} selected',
        valueCount: '{{count}} values',
        confirmRemoveTitle: 'Remove this chart?',
        confirmRemoveBody:
          '“{{title}}” will be taken off the view. The chat that produced it is untouched.',
        confirmDeleteTitle: 'Delete this view?',
        confirmDeleteBody:
          '“{{name}}” and all of its charts will be deleted. This cannot be undone.',
      },
      table: {
        page: 'Page {{page}} of {{pages}}',
        noRows: 'No results',
        yes: 'Yes',
        no: 'No',
        previous: 'Previous page',
        next: 'Next page',
      },
      settings: {
        title: 'Model settings',
        counts: '{{tables}} tables · {{measures}} measures',
        lastSync: 'Last sync: {{day}} at {{time}}',
        neverSynced: 'Never synced with Power BI',
        source: 'Power BI model',
        sourceHelp:
          "Configured through the server's PBI_* variables. To point the app at a different model, change them and restart it.",
        extraContext: 'Additional context',
        extraContextHelp:
          'Written by the assistant from the model itself, and added to its prompt at every stage. Correct or extend it: unclear table names, business vocabulary, caveats about specific columns.',
        extraContextPlaceholder:
          'E.g. TBL_VTA_CAB is the sales header. "Revenue" = retail price × units.',
        contextGeneratedAt: 'Written by the assistant on {{day}} at {{time}}',
        contextEdited: 'Edited by hand',
        reprocess: 'Reprocess context',
        reprocessing: 'Reprocessing…',
        reprocessHelp:
          'The assistant reads the model again and rewrites the text above. Use it after the model changes.',
        reprocessConfirm:
          'The assistant will rewrite the additional context from the model. The current text, your edits included, will be lost.',
        sync: 'Sync model',
        syncDone: 'Synced in {{seconds}}s',
        syncCounts:
          '{{tables}} tables · {{columns}} columns · {{measures}} measures · {{removed}} removed',
        syncWroteContext: 'It also wrote the model context.',
        noDataset: 'No data model connected.',
        save: 'Save',
      },
      account: {
        title: 'My account',
        currentPassword: 'Current password',
        newPassword: 'New password',
        repeatPassword: 'Repeat the password',
        mismatch: 'The two passwords do not match',
        changed: 'Password updated. Every other session has been signed out.',
        save: 'Change the password',
      },
      users: {
        title: 'Users',
        help: 'Accounts are created by an admin only. Everyone can change their own password.',
        admin: 'Admin',
        add: 'Add a user',
        addHint: 'At least 12 characters. You will have to pass it on yourself.',
        create: 'Create the account',
        makeAdmin: 'Give them admin permissions',
        remove: 'Remove the user',
        cannotRemoveSelf: 'You cannot remove your own account',
        removeTitle: 'Remove this user?',
        removeBody:
          '{{email}} will be removed along with their conversations and dashboards. This cannot be undone.',
        resetPassword: 'Reset',
        newPassword: 'New password',
        resetHint: 'At least 12 characters. Every session of that user is signed out.',
        setPassword: 'Save the password',
        resetDone: 'Password reset.',
      },
      common: {
        retry: 'Retry',
        close: 'Close',
        loading: 'Loading…',
        error: 'Something went wrong',
        lightMode: 'Light mode',
        darkMode: 'Dark mode',
        cancel: 'Cancel',
        delete: 'Delete',
        rename: 'Rename',
        actions: 'Actions',
        regenerateTitle: 'Regenerate title',
        updatedOn: 'Updated {{day}}',
        createdOn: 'Created {{day}}',
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
