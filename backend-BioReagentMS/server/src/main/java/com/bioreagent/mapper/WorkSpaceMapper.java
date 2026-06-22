package com.bioreagent.mapper;

import com.bioreagent.entity.Reagent;
import com.bioreagent.vo.InboundRecordVO;
import com.bioreagent.vo.InboundReportVO;
import com.bioreagent.vo.InventoryReportVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface WorkSpaceMapper {

    @Select("SELECT (SELECT COUNT(*) FROM reagent) AS reagentTypeCount, (SELECT COALESCE(SUM(current_quantity), 0) FROM reagent_batch WHERE status IN (0, 1)) AS totalStock FROM DUAL")
    InventoryReportVO getKindAndStock();

    @Select("SELECT COUNT(*) FROM reagent_batch WHERE status IN (0, 1)")
    Integer getActiveBatchCount();

    @Select("SELECT COUNT(*) FROM warning_record WHERE warning_type = 'SHORTAGE' AND status = 0")
    Integer getShortageWarningCount();

    @Select("SELECT COUNT(*) FROM warning_record WHERE warning_type = 'EXPIRY' AND status = 0")
    Integer getExpiryWarningCount();

    @Select("SELECT r.id, r.name, r.cas_number, r.specification, r.purity, r.category_id, " +
            "r.unit, r.storage_condition, r.safety_stock_threshold, r.warning_advance_days, " +
            "r.status, r.create_time, " +
            "(SELECT COALESCE(SUM(current_quantity), 0) FROM reagent_batch " +
            "WHERE reagent_id = r.id AND status IN (0, 1)) AS total_stock " +
            "FROM reagent r ORDER BY r.id DESC")
    List<Reagent> getList();

    /** 近30天入库概览 */
    @Select("SELECT COUNT(*) AS totalOfTime, COUNT(DISTINCT reagent_id) AS totalOfKind, COALESCE(SUM(quantity), 0) AS totalOfStock, COALESCE(SUM(quantity * unit_price), 0) AS totalOfPrice FROM warehouse_receipt WHERE receipt_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)")
    InboundReportVO getInboundSummary();

    /** 近30天入库明细 */
    @Select("SELECT receipt_number AS receiptNumber, reagent_name AS reagentName, quantity, unit_price AS unitPrice, (quantity * unit_price) AS totalAmount, operator_name AS operatorName, receipt_time AS receiptTime, remark FROM warehouse_receipt WHERE receipt_time >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY receipt_time DESC")
    List<InboundRecordVO> getInboundList();
}
