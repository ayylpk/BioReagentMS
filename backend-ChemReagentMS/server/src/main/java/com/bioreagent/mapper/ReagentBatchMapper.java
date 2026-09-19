package com.bioreagent.mapper;

import com.bioreagent.QueryParam.ReagentBatchQueryParam;
import com.bioreagent.entity.ReagentBatch;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface ReagentBatchMapper {

    List<ReagentBatch> list(ReagentBatchQueryParam queryParam);

    @Select("SELECT * FROM reagent_batch WHERE id = #{id}")
    ReagentBatch getById(Long id);

    void insert(ReagentBatch batch);

    void update(ReagentBatch batch);

    void delete(Long id);

    /** 按过期时间升序取在库批次，用于 FEFO 出库 */
    @Select("SELECT * FROM reagent_batch WHERE reagent_id = #{reagentId} AND status IN (0, 1) AND current_quantity > 0 ORDER BY expiry_date ASC")
    List<ReagentBatch> listAvailableByReagentId(Long reagentId);

    /**
     * 扣减批次库存（**条件原子扣减**）。
     * ⚠️ 必须带 current_quantity >= quantity 这个守卫，并把影响行数返回给调用方：
     *    旧写法是无守卫的 `SET current_quantity = current_quantity - #{quantity}`——
     *    并发审批同一批次时两个事务都能扣成功，库存扣成负数，而调用方拿不到任何反馈（= 超卖）。
     * 返回 0 = 库存不足 or 被并发抢走，调用方应据此重读批次或中止本次出库。
     */
    @org.apache.ibatis.annotations.Update("UPDATE reagent_batch SET current_quantity = current_quantity - #{quantity} WHERE id = #{id} AND current_quantity >= #{quantity}")
    int deductStock(@org.apache.ibatis.annotations.Param("id") Long id, @org.apache.ibatis.annotations.Param("quantity") Integer quantity);

    /**
     * 扣减后把已用尽的批次标记为 status=2。
     * 必须用条件 SQL，**不能**拿内存里的旧对象整列 update ——
     * 后者会把并发扣减的结果覆盖回旧值（典型的丢更新：10 - 8 = 2 覆盖掉两次真实扣减）。
     */
    @org.apache.ibatis.annotations.Update("UPDATE reagent_batch SET status = 2 WHERE id = #{id} AND current_quantity <= 0")
    int markDepletedIfEmpty(@org.apache.ibatis.annotations.Param("id") Long id);


    /** 按试剂 ID 列表批量删除批次（删试剂时级联调用） */
    void deleteByReagentIds(List<Long> reagentIds);

}
