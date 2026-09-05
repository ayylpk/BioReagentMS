// MySQL 连接池（Java 类比：HikariCP）。工具侧只读，service 侧自有表（人审队列/摄取台账）才写
import mysql from 'mysql2/promise'
import { config } from '../config/env'

export const pool = mysql.createPool({
  host: config.MYSQL_HOST,
  port: config.MYSQL_PORT,
  user: config.MYSQL_USER,
  password: config.MYSQL_PASSWORD,
  database: config.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 4, // 工具是参数化只读查询，小池子够用
})

/** 只读执行器：工具层唯一入口，语句必须是 SELECT（代码断言，不靠自觉） */
export async function queryReadOnly<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!/^\s*select\s/i.test(sql)) throw new Error('queryReadOnly 只允许 SELECT')
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}
