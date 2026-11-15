import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ClassDetailPage from '../pages/ClassDetailPage.jsx';
import api from '../api/client.js';
vi.mock('../api/client.js',()=>({default:{get:vi.fn(),post:vi.fn(),patch:vi.fn()},newIdempotencyKey:()=>crypto.randomUUID()}));
vi.mock('../auth/AuthContext.jsx',()=>({useAuth:()=>({isManager:true})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const pupil={id:'4',fullName:'Тестовий Учень',ticketNumber:'T-4',category:'student',schoolClass:{id:'1',name:'7-А'},ticketExpiresOn:'2099-06-30',version:'1'};
function setup() {
  api.get.mockImplementation(async(path,query)=>path==='/api/v1/school-classes'?{data:[{id:'1',name:'7-А',isActive:true},{id:'2',name:'8-А',isActive:true}]}:path==='/api/v1/readers/4'?{data:pupil}:{data:[pupil],meta:{page:query.page,totalPages:2,totalItems:26}});
  render(<MemoryRouter initialEntries={['/classes/1']}><Routes><Route path="/classes/:classId" element={<ClassDetailPage/>}/></Routes></MemoryRouter>);
}
describe('картка класу',()=>{
  it('фільтрує учнів на сервері до пагінації та передає клас у масову видачу',async()=>{
    setup();await screen.findByRole('heading',{name:'Клас 7-А'});
    expect(api.get).toHaveBeenCalledWith('/api/v1/readers',expect.objectContaining({classId:'1',category:'student',page:1}));
    expect(screen.getByRole('link',{name:'Видати підручники класу'}).getAttribute('href')).toBe('/loans/batch?classId=1');
    fireEvent.click(screen.getByRole('button',{name:'Далі →'}));
    await waitFor(()=>expect(api.get).toHaveBeenCalledWith('/api/v1/readers',expect.objectContaining({classId:'1',page:2})));
  });
  it('нова реєстрація одразу має вибраний клас',async()=>{
    setup();await screen.findByRole('heading',{name:'Клас 7-А'});
    fireEvent.click(screen.getByRole('button',{name:'+ Новий учень'}));
    await waitFor(()=>expect(screen.getByLabelText('Клас').value).toBe('1'));
  });
  it('прибирання з класу змінює наявну картку без видалення чи дублювання',async()=>{
    setup();api.patch.mockResolvedValue({data:{...pupil,schoolClass:null}});
    await screen.findByText('Тестовий Учень');
    fireEvent.click(screen.getByRole('button',{name:'Змінити клас'}));
    fireEvent.change(screen.getByLabelText('Новий клас'),{target:{value:''}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Підтвердити'}).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Підтвердити'}));
    await waitFor(()=>expect(api.patch).toHaveBeenCalledWith('/api/v1/readers/4',{classId:null,version:'1'}));
    expect(api.post).not.toHaveBeenCalled();
  });
});
