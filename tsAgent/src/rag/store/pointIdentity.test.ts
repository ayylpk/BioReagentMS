// 离线单测：文档身份（docIdOf）+ point identity（pointId）+ 重摄幂等
// 不连 Qdrant / MySQL / 网络：upsert.ts 只 import 进来用里面的**纯函数** pointId（构造 client 不建连）
import { test, expect } from 'bun:test'
import { resolve } from 'node:path'
import { docIdOf, CORPUS, ROOT } from '../inspect/identity'
import { pointId } from './upsert'
import { bySection } from '../chunk/bySection'
import type { Block } from '../inspect/profile'

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('pointId：同 docId+seq 任何时候都算出同一个 id（重摄幂等的前提）', () => {
	expect(pointId('chem__硫酸', 0)).toBe(pointId('chem__硫酸', 0))
	expect(pointId('ICSC-0001-氢', 137)).toBe(pointId('ICSC-0001-氢', 137))
	expect(pointId('a', 0)).toBe(pointId('a', 0))
})

test('pointId：RFC4122 v5 风格的 UUID 字符串（Qdrant 原生接受）', () => {
	expect(pointId('chem__硫酸', 0)).toMatch(UUID_V5)
	expect(pointId('ICSC-0001-氢', 42)).toMatch(UUID_V5)
})

test('pointId：不同 docId 或不同 seq → 不同 id', () => {
	expect(pointId('a', 0)).not.toBe(pointId('a', 1))
	expect(pointId('a', 0)).not.toBe(pointId('b', 0))
	expect(pointId('a', 0)).not.toBe(pointId('ab', 0))       // 拼接串不歧义：`a#0` vs `ab#0`
	expect(pointId('a#1', 0)).not.toBe(pointId('a', 10))     // 分隔符不可能被 docId 里的 # 蒙混
})

test('pointId 碰撞回归：1e4 量级输出全不重复（旧 32 位 FNV 在这个量级已必然碰撞）', () => {
	const ids = new Set<string>()
	let n = 0
	for (let d = 0; d < 200; d++) {
		for (let s = 0; s < 50; s++) { ids.add(pointId(`doc-${d}`, s)); n++ }
	}
	expect(n).toBe(10_000)
	expect(ids.size).toBe(n)
})

test('docIdOf：corpus 根下的文档与旧口径逐字相同（这批无需重摄）', () => {
	expect(docIdOf(resolve(CORPUS, 'ICSC-0001-氢.md'))).toBe('ICSC-0001-氢')
	expect(docIdOf(resolve(CORPUS, '硫酸.pdf'))).toBe('硫酸')
})

test('docIdOf：目录层级折进 id，同名不同目录不再互相覆盖', () => {
	const a = docIdOf(resolve(CORPUS, 'chemistry/硫酸.pdf'))
	const b = docIdOf(resolve(CORPUS, 'bio/硫酸.pdf'))
	expect(a).toBe('chemistry__硫酸')
	expect(b).toBe('bio__硫酸')
	expect(a).not.toBe(b)                 // 旧口径下两者都是 '硫酸' → 后摄的按 doc_id 删掉先摄的
})

test('docIdOf：同一路径稳定；corpus 外走工程相对路径；工程外退化为 名字__哈希8', () => {
	const p = resolve(ROOT, 'samples/硫酸-sop.txt')
	expect(docIdOf(p)).toBe(docIdOf(p))
	expect(docIdOf(p)).toBe('samples__硫酸-sop')

	const outside = process.platform === 'win32' ? 'C:/tmp/外盘同名.txt' : '/tmp/外盘同名.txt'
	expect(docIdOf(outside)).toMatch(/^外盘同名__[0-9a-f]{8}$/)
	expect(docIdOf(outside)).toBe(docIdOf(outside))
})

test('重摄幂等：同一份 blocks 连续切两次 → doc_id 集合与 point id 集合完全一致', () => {
	const rows = Array.from({ length: 90 }, (_, i) => `| 行${i + 1}甲 | 行${i + 1}乙 | ${'x'.repeat(30)} |`)
	const blocks: Block[] = [
		{ type: 'heading', level: 1, markdown: '硫酸安全技术说明书' },
		{ type: 'heading', level: 2, markdown: '3 成分/组成信息' },
		{ type: 'text', markdown: '本品为无色油状液体，具有强腐蚀性。' },
		{ type: 'heading', level: 3, markdown: '3.1 成分表' },
		{ type: 'table', markdown: ['| 名称 | 含量 | 备注 |', '| --- | --- | --- |', ...rows].join('\n') },
		{ type: 'heading', level: 2, markdown: '9 理化特性' },
		{ type: 'text', markdown: '相对密度 1.84，沸点 337℃。' },
	]
	const file = resolve(CORPUS, 'chem/硫酸.md')

	const run1 = bySection(file, blocks)
	const run2 = bySection(file, blocks)

	// 台账/payload 的 doc_id 集合
	expect(new Set(run1.map(c => c.docId))).toEqual(new Set(run2.map(c => c.docId)))
	// point id 集合（真正的主键）
	expect(new Set(run1.map(c => pointId(c.docId, c.seq)))).toEqual(new Set(run2.map(c => pointId(c.docId, c.seq))))
	// 顺带：切块结果本身逐字节确定
	expect(run1).toEqual(run2)
	expect(run1.length).toBeGreaterThan(1)
	// seq 从 0 连续递增（upsert 的 payload.seq 与 pointId 都靠它）
	expect(run1.map(c => c.seq)).toEqual(Array.from({ length: run1.length }, (_, i) => i))
	expect(new Set(run1.map(c => pointId(c.docId, c.seq))).size).toBe(run1.length)
})
