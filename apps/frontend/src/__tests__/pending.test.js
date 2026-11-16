import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { request } from '../api/client.js';
import { pendingRequests, setRequestActor } from '../api/pending.js';
beforeEach(()=>{sessionStorage.clear();setRequestActor('1');vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{setRequestActor(null);vi.unstubAllGlobals();});
it('зберігає незмінний запит після втрати відповіді та відновлює його після повторного входу',async()=>{
  fetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(request('/api/v1/loans',{method:'POST',body:{readerId:'2',copyId:'3'},idempotencyKey:'original'})).rejects.toMatchObject({code:'NETWORK_ERROR'});
  setRequestActor(null);expect(pendingRequests()).toEqual([]);
  setRequestActor('2');expect(pendingRequests()).toEqual([]);
  setRequestActor('1');const saved=pendingRequests()[0];expect(saved.key).toBe('original');
  await expect(request(saved.path,{method:saved.method,body:{readerId:'99'},idempotencyKey:saved.key})).rejects.toMatchObject({code:'PENDING_OPERATION'});
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce({ok:true,status:201,json:async()=>({data:{id:'10'}})});
  const result=await request(saved.path,{method:saved.method,body:saved.body,idempotencyKey:saved.key});
  expect(result.data.id).toBe('10');expect(pendingRequests()).toEqual([]);
  expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe('original');
});
it('не забуває операцію після HTTP 500 або непрочитаної відповіді',async()=>{
  fetch.mockResolvedValueOnce({ok:false,status:500,headers:new Headers(),json:async()=>({error:{code:'INTERNAL_ERROR',message:'Помилка'}})});
  await expect(request('/api/v1/loans',{method:'POST',body:{copyId:'3'},idempotencyKey:'original'})).rejects.toMatchObject({status:500});
  expect(pendingRequests()).toHaveLength(1);
});
