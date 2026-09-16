// 离线单测：JWT 校验 + 权限守卫（不连 MySQL、不起服务）
// 覆盖：签名往返 / 篡改 / 错 secret / 过期 / alg=none 降级 / token 头口径 / 守卫三分支 / 审核人 uid
// 纪律：人审端点能改知识库内容，"少配 secret 就放行"是最危险的失败姿态 —— 这里把 503 钉死
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createGuard, reviewerIdOf, roleHasPermission, signJwt, tokenOf, verifyJwt } from './auth'

const SECRET = 'test-secret-not-a-real-one'

describe('verifyJwt / signJwt', () => {
	test('签名往返：payload 原样回来', () => {
		const token = signJwt({ uid: 7, role: 1 }, SECRET)
		const p = verifyJwt(token, SECRET)
		expect(p?.uid).toBe(7)
		expect(p?.role).toBe(1)
		expect(typeof p?.exp).toBe('number')
	})

	test('篡改 payload → 拒（签名对不上）', () => {
		const token = signJwt({ uid: 7, role: 1 }, SECRET)
		const [h, , s] = token.split('.')
		const forged = Buffer.from(JSON.stringify({ uid: 7, role: 0, exp: Math.floor(Date.now() / 1000) + 999 }))
			.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
		expect(verifyJwt(`${h}.${forged}.${s}`, SECRET)).toBeNull()
	})

	test('换过 secret → 拒（两边不是同一个 secret 就进不来）', () => {
		expect(verifyJwt(signJwt({ uid: 1, role: 1 }, SECRET), 'another-secret')).toBeNull()
	})

	test('过期 → 拒（ttl 负数直接签一个已过期的）', () => {
		expect(verifyJwt(signJwt({ uid: 1, role: 1 }, SECRET, -10), SECRET)).toBeNull()
	})

	test('★ alg=none 降级 → 拒（JWT 最经典的绕过手法）', () => {
		const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64').replace(/=+$/, '')
		const p = Buffer.from(JSON.stringify({ uid: 1, role: 0, exp: Math.floor(Date.now() / 1000) + 999 })).toString('base64').replace(/=+$/, '')
		expect(verifyJwt(`${h}.${p}.`, SECRET)).toBeNull()
		expect(verifyJwt(`${h}.${p}.whatever`, SECRET)).toBeNull()
	})

	test('结构/编码坏了 → 拒，不抛', () => {
		for (const bad of ['', 'a', 'a.b', 'a.b.c', '...', 'x.y.z']) expect(verifyJwt(bad, SECRET)).toBeNull()
	})

	test('secret 为空 → 一律拒（不给"没配 secret 就全通过"留缝）', () => {
		expect(verifyJwt(signJwt({ uid: 1, role: 0 }, ''), '')).toBeNull()
	})
})

describe('tokenOf：前端 `token` 头优先，Authorization Bearer 兼容', () => {
	const app = new Hono()
	app.get('/x', (c) => c.json({ t: tokenOf(c) }))
	const get = async (headers: Record<string, string>) => ((await (await app.request('/x', { headers })).json()) as { t: string }).t

	test('token 头', async () => expect(await get({ token: 'abc' })).toBe('abc'))
	test('Authorization: Bearer', async () => expect(await get({ authorization: 'Bearer xyz' })).toBe('xyz'))
	test('两者都有 → 以 token 头为准', async () => expect(await get({ token: 'abc', authorization: 'Bearer xyz' })).toBe('abc'))
	test('都没有 → 空串', async () => expect(await get({})).toBe(''))
})

describe('createGuard：503 / 401 / 403 / 放行 四条分支', () => {
	const build = (secret: string, perms: string[] = []) => {
		const guard = createGuard({ secret: () => secret, hasPermission: async (_role, code) => perms.includes(code) })
		const app = new Hono()
		app.get('/guarded', async (c) => {
			const r = await guard(c, 'ragReview:query')
			if (!r.ok) return r.response!
			return c.json({ ok: true, uid: r.payload?.uid })
		})
		return app
	}
	const token = signJwt({ uid: 9, role: 2 }, SECRET)

	test('★ 没配 secret → 503（绝不敞开）', async () => {
		const res = await build('').request('/guarded', { headers: { token } })
		expect(res.status).toBe(503)
		expect(((await res.json()) as { error: string }).error).toContain('JWT_SECRET_KEY')
	})

	test('没带 token / 带假 token → 401', async () => {
		expect((await build(SECRET).request('/guarded')).status).toBe(401)
		expect((await build(SECRET).request('/guarded', { headers: { token: 'a.b.c' } })).status).toBe(401)
	})

	test('token 有效但缺权限码 → 403，且说清缺哪个', async () => {
		const res = await build(SECRET, []).request('/guarded', { headers: { token } })
		expect(res.status).toBe(403)
		expect(((await res.json()) as { error: string }).error).toContain('ragReview:query')
	})

	test('有权限 → 放行，payload 原样可用', async () => {
		const res = await build(SECRET, ['ragReview:query']).request('/guarded', { headers: { token } })
		expect(res.status).toBe(200)
		expect(((await res.json()) as { uid: number }).uid).toBe(9)
	})

	test('token 里没有 role → 403（说不清是什么角色就不放行）', async () => {
		const noRole = signJwt({ uid: 9 }, SECRET)
		expect((await build(SECRET, ['ragReview:query']).request('/guarded', { headers: { token: noRole } })).status).toBe(403)
	})
})

describe('roleHasPermission / reviewerIdOf', () => {
	test('role 0（系统管理员）先于查库放行 —— 惯例全通，别把管理员关在门外', async () => {
		// 不连库也能过：role 0 在查询之前就 return true（本地无 MySQL 时这条是"真"断言）
		expect(await roleHasPermission(0, 'ragReview:audit')).toBe(true)
		expect(await roleHasPermission(0, '任何码')).toBe(true)
	})

	test('reviewerIdOf：uid / userId / id 都认', () => {
		expect(reviewerIdOf({ uid: 3 })).toBe(3)
		expect(reviewerIdOf({ userId: 4 })).toBe(4)
		expect(reviewerIdOf({ id: 5 })).toBe(5)
	})

	test('★ 拿不到审核人 → 抛（不许写一条"无人负责"的审核记录）', () => {
		const bads = [{}, { uid: 0 }, { uid: -1 }, { uid: 'x' }] as unknown as Parameters<typeof reviewerIdOf>[0][]
		for (const bad of bads) {
			let threw = false
			try { reviewerIdOf(bad) } catch { threw = true }
			expect(threw).toBe(true)
		}
	})
})
