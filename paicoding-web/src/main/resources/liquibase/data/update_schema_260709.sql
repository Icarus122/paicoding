-- 图片尺寸表：持久化正文图片宽高，渲染时补充 width/height 占位，消除 CLS
-- Author: Claude
-- Date: 2026-07-09

CREATE TABLE IF NOT EXISTS `image_dimension`
(
    `id`          bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `url_hash`    char(32)      NOT NULL COMMENT '图片URL的MD5',
    `url`         varchar(1024) NOT NULL COMMENT '图片URL',
    `width`       int(11)       NOT NULL DEFAULT 0 COMMENT '原始宽度(像素)',
    `height`      int(11)       NOT NULL DEFAULT 0 COMMENT '原始高度(像素)',
    `create_time` datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_url_hash` (`url_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='图片尺寸缓存表';
