import { sleep } from "rati";
import "./App.css";

export function App() {
    return (
        <div className="App">
            Test
            <br />
            <br />
            <button
                onClick={async () => {
                    await sleep(2000);
                    alert("ok");
                }}
            >
                test rati
            </button>
        </div>
    );
}
