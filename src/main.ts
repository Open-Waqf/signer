import './style.css'; // Global styles (Reset, Fonts, Dialogs)
import './app-root'; // The Main App Component

// Listen for the 'show-privacy' event dispatched from the Header
document.addEventListener('show-privacy', () => {
    const appRoot = document.querySelector('app-root') as any;
    if (appRoot) appRoot.showPrivacy();
});