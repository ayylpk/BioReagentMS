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

    /** 扣减批次库存 */
    @org.apache.ibatis.annotations.Update("UPDATE reagent_batch SET current_quantity = current_quantity - #{quantity} WHERE id = #{id}")
    void deductStock(@org.apache.ibatis.annotations.Param("id") Long id, @org.apache.ibatis.annotations.Param("quantity") Integer quantity);


    /** 按试剂 ID 列表批量删除批次（删试剂时级联调用） */
    void deleteByReagentIds(List<Long> reagentIds);

}
