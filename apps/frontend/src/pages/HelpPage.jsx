import { PageHeader } from '../components/ui.jsx';

const GUIDE_URL = '/help/posibnyk.pdf';

export default function HelpPage() {
  return (
    <>
      <PageHeader
        title="Допомога"
        actions={<a className="btn btn--primary" href={GUIDE_URL} download="Biblioteka-Obriy-nastanova.pdf">Завантажити PDF</a>}
      />
      <p className="field__hint">
        Настанова користувача. Якщо документ не відображається у вікні, відкрийте його{' '}
        <a href={GUIDE_URL} target="_blank" rel="noreferrer">в окремій вкладці</a>.
      </p>
      <object data={GUIDE_URL} type="application/pdf" aria-label="Настанова користувача"
        style={{ width: '100%', height: 'calc(100vh - 190px)', minHeight: 480, border: '1px solid var(--line)' }}>
        <div className="empty">
          Браузер не може показати PDF у вікні. <a href={GUIDE_URL} target="_blank" rel="noreferrer">Відкрити настанову</a>.
        </div>
      </object>
    </>
  );
}
