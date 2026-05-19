import React from "react";
import { globalLogger } from "#base/logger/logger";

export const useWhyDidYouUpdate = (name: string, props: Record<string, unknown>) => {
    const previousProps = React.useRef<Record<string, unknown>>({});

    React.useEffect(() => {
        const allKeys = Object.keys({ ...previousProps.current, ...props });
        const changedKeys = allKeys.filter((key) => previousProps.current[key] !== props[key]);

        if (changedKeys.length > 0) {
            globalLogger.info(`[${name}] re-render caused by: ${changedKeys.join(", ")}`);
            // changedKeys.forEach(key => {
            //   globalLogger.info(`  KEY==='${key}': '${previousProps.current[key]}' → '${props[key]}' `);
            // });
        }

        previousProps.current = props;
    });
};
