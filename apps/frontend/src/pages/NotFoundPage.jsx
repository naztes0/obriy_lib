import { Link } from 'react-router-dom';
export default function NotFoundPage() {
  return (
    <div className="card">
      <h1>Сторінку не знайдено (404)</h1>
      <p>Такої адреси немає. <Link to="/books">Перейти до каталогу</Link></p>
    </div>
  );
}
