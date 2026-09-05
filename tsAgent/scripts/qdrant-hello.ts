// Qdrant × 本地 embedding 实操：真中文文本 → Ollama bge-m3(1024维) → 入库 → 自然语言检索 → 过滤对照
// 前置：Ollama 已启动（D:\ollama）且已拉 modelscope.cn/gpustack/bge-m3-GGUF；Qdrant 容器在跑
// 跑法：bun run scripts/qdrant-hello.ts   （幂等，可反复跑；首跑模型加载 437MB 会慢几秒）
import { QdrantClient } from "@qdrant/js-client-rest";

const OLLAMA_URL = "http://localhost:11434";
const EMBED_MODEL = "modelscope.cn/gpustack/bge-m3-GGUF:latest";
const COLLECTION = "sds_embed_demo";
const DIM = 1024; // bge-m3 固定输出维度，和 tsAgent 的 EMBED_DIM 规划一致

const client = new QdrantClient({ host: "localhost", port: 6333 });

/** 调 Ollama 原生 /api/embed：文字进、向量出（支持批量，一次请求多条） */
async function embed(texts: string[]): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
  } catch {
    throw new Error("连不上 Ollama —— 先启动它（D:\\ollama 跑起来），再重跑本脚本");
  }
  if (!res.ok) throw new Error(`embedding 接口 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { embeddings?: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) throw new Error("Ollama 返回的向量数量对不上");
  return data.embeddings;
}

// 语料：6 条仿 SDS 分节片段（section/cas_number 是给 payload filter 准备的元数据）
const DOCS = [
  { cas_number: "7664-93-9", section: "消防措施", source_doc: "硫酸SDS", text: "硫酸本身不燃，但遇水大量放热，可使易燃物、有机物碳化起火。灭火可用干粉、二氧化碳、砂土，禁止用水直冲酸液。" },
  { cas_number: "7664-93-9", section: "急救措施", source_doc: "硫酸SDS", text: "皮肤接触后立即用大量流动清水冲洗至少15分钟，就医；切勿先尝试中和，稀释时应将酸缓缓加入水中。" },
  { cas_number: "67-64-1",  section: "消防措施", source_doc: "丙酮SDS", text: "丙酮高度易燃。灭火剂选用抗溶性泡沫、干粉、二氧化碳；用水灭火无效，但可用水冷却火场中的容器。" },
  { cas_number: "67-64-1",  section: "储存条件", source_doc: "丙酮SDS", text: "储存于阴凉通风仓库，温度不宜超过29℃，远离火种热源，与氧化剂、酸类分开存放，切忌混储。" },
  { cas_number: "7647-01-0", section: "急救措施", source_doc: "盐酸SDS", text: "吸入盐酸气体应迅速脱离现场至空气新鲜处，保持呼吸道通畅；皮肤接触用大量流动清水冲洗至少15分钟。" },
  { cas_number: "1310-73-2", section: "消防措施", source_doc: "氢氧化钠SDS", text: "氢氧化钠不燃，但遇水和水蒸气大量放热形成腐蚀性溶液，与酸发生中和反应放热。灭火方法：用水、砂土及各种灭火器扑灭。" },
];

function show(tag: string, points: { id: number | string; score: number; payload?: Record<string, unknown> | null }[]) {
  console.log(`\n${tag}`);
  for (const h of points) {
    const p = h.payload as { section?: string; source_doc?: string } | undefined;
    console.log(`   score=${h.score.toFixed(4)}  ${p?.section}  ${p?.source_doc}`);
  }
  if (!points.length) console.log("   （空）");
}

async function main() {
  // 0. 维度自检：确认 bge-m3 吐的确实是 1024
  const probeVec = (await embed(["维度自检"]))[0];
  console.log(`[0] bge-m3 输出维度 = ${probeVec?.length}（期望 ${DIM}）`);

  // 1. 建库（幂等重跑先清场）：1024 维
  await client.deleteCollection(COLLECTION).catch(() => {});
  await client.createCollection(COLLECTION, { vectors: { size: DIM, distance: "Dot" } });
  await client.createPayloadIndex(COLLECTION, { field_name: "section", field_schema: "keyword" });
  await client.createPayloadIndex(COLLECTION, { field_name: "cas_number", field_schema: "keyword" });

  // 2. 批量向量化 + 入库（一次 embed 请求搞定 6 条 —— 生产 upsert 也就长这样）
  const vectors = await embed(DOCS.map(d => d.text));
  await client.upsert(COLLECTION, {
    wait: true,
    points: DOCS.map((d, i) => ({ id: i + 1, vector: vectors[i] as number[], payload: d })),
  });
  console.log(`[1] 6 条 SDS 片段已入库 ${COLLECTION}，点数 =`, (await client.count(COLLECTION, { exact: true })).count);

  // 3. 自然语言查询：只 embed 问题本身，剩下的交给相似度
  const question = "浓硫酸着火了怎么灭火";
  const [qv] = await embed([question]);
  show(`[2] 无过滤 top5  ← 查询：「${question}」`,
    (await client.query(COLLECTION, { query: qv as number[], limit: 5, with_payload: true })).points);

  // 4. 同问 + 分节过滤：把"答案必须出自消防措施节"变成硬约束
  show("[3] filter section=消防措施:",
    (await client.query(COLLECTION, {
      query: qv as number[], limit: 5, with_payload: true,
      filter: { must: [{ key: "section", match: { value: "消防措施" } }] },
    })).points);

  // 5. 换个问法看语义是否稳：储存问题应该把丙酮储存条件顶上来
  const [qv2] = await embed(["丙酮应该存在什么环境里"]);
  show("[4] 换查询：「丙酮应该存在什么环境里」 top3:",
    (await client.query(COLLECTION, { query: qv2 as number[], limit: 3, with_payload: true })).points);
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });